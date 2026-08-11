import { Asset } from "expo-asset";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import FrameClockView from "../../modules/frame-clock/src/FrameClockView";
import type {
  FrameClockHandle,
  FrameClockStats,
} from "../../modules/frame-clock/src/FrameClock.types";
import { ProbeCard } from "./ProbeCard";
import {
  PROBES,
  judgeOverlayDrift,
  judgeArtifact,
  judgeSeekError,
  type Probe,
  type ProbeStatus,
} from "./probes";
import { CaptureProbe } from "./CaptureProbe";
import { recordResult } from "./record";
import { Skeleton } from "./Skeleton";
import { buildIndex, frameAt, type PoseBundle } from "./pose";
import { COLORS, styles } from "./styles";

/**
 * SwingSage — spike harness (platform-foundation step 02).
 *
 * This is deliberately NOT the product. It exists to answer three questions on real hardware
 * before any feature is built on the framework choice recorded in DECISIONS D5.
 *
 * The order matters. Step 01's research confirmed an iOS path for the per-frame overlay callback
 * and could NOT confirm the Android equivalent, so the unconfirmed risk sits entirely on the
 * device already available and OVERLAY SYNC is question 1. If it fails on Android, the other two
 * never need measuring and D5 reopens.
 */

/**
 * The two clips, and why there are two.
 *
 * `synthetic` is the CORRECTNESS instrument: its pixels encode ground truth, so drift is
 * measurable to a fraction of a frame. `real` is the COST test — 49 keypoints redrawn every frame
 * is the actual workload, and a strategy that pins one marker line perfectly can still collapse
 * on it. Neither replaces the other, so both ship and both get measured.
 *
 * The real clip carries the same machine-readable sweeping bar composited onto real footage
 * (scripts/make_real_clip.py), so ground truth survives the move to real content instead of
 * degrading into "looks about right".
 */
const CLIPS = {
  synthetic: {
    label: "Synthetic",
    blurb: "Ground truth in the pixels. Measures whether the overlay lands on the right frame.",
    module: require("../../assets/frameclock.mp4"),
    fps: 60,
    frames: 600,
    pose: null as null | PoseBundle,
  },
  real: {
    label: "Real swing",
    blurb: "swing1, 49 keypoints from its own analysis.json. Measures what the overlay costs.",
    module: require("../../assets/swing1-stamped.mp4"),
    fps: 60,
    frames: 396,
    pose: require("../../assets/swing1-pose.json") as PoseBundle,
  },
} as const;

type ClipKey = keyof typeof CLIPS;

/**
 * Geometry of the burned-in sweeping bar. **Must match `scripts/make-frame-clip.mjs`.**
 *
 * These exist because getting them wrong produced the most instructive failure of this spike: the
 * marker was positioned against the window width rather than the rendered video width, so it and
 * the bar swept at slightly different rates and separated by ~20px across the clip. On screen that
 * is a gap that **grows over time**, which is the signature of a scale error — a genuine sync lag
 * would show a *constant* offset. The probe still reported PASS throughout, because frame identity
 * and marker placement are different questions and the closed loop only measures the first.
 *
 * Caught by looking at the picture, not by the numbers. Same reason the analyzer has Gate 1.
 */
const CLIP_WIDTH_PX = 720;
const BAR_WIDTH_PX = 12;
/** Width of the JS marker, in screen px. Kept thin so a one-frame error is still visible. */
const MARKER_WIDTH = 2;
/** Width of each calibration tick. Wide enough to survive any resampling in the screen capture. */
const CAL_TICK_WIDTH = 4;

/** How long the overlay-sync probe plays for. 5s at 60fps is ~300 samples, over the n≥120 bar. */
const OVERLAY_RUN_MS = 5_000;

/**
 * The PC serving real artifacts over the LAN (`scripts/serve-fixtures.mjs`).
 *
 * Hardcoded rather than discovered: this is a spike driven from one machine, and a device that
 * cannot reach it should FAIL the network probes loudly rather than silently fall back to the
 * bundled clip and report a number that measures nothing.
 */
const FIXTURE_ORIGIN = "http://10.0.1.107:8790";

/**
 * Seek targets for probe 2.
 *
 * Fixed rather than random so a re-run is comparable, and chosen to land in every position
 * relative to the GOP of 10 — on a keyframe (150, 300), one frame after one (151), and one frame
 * before the next (149, 299). Android decodes-and-skips from the preceding sync point, so a
 * target just before a keyframe is the worst case and has to be in the set or the probe measures
 * only the easy half of the problem.
 */
const SEEK_TARGETS = (() => {
  /**
   * D34: this ran on 20 targets against a `minSamples` of 120, so its FAIL was real but
   * under-sampled — and `judgeSeekError` did not apply the too-few gate that `judgeOverlayDrift`
   * does, so nothing said so. Both are fixed.
   *
   * The hand-picked worst cases stay FIRST and unchanged, so runs remain comparable; the rest of
   * the clip is then swept at every offset within the GOP of 10, which is what actually gets the
   * count over the bar without inventing easy targets.
   */
  const handPicked = [
    150, 151, 149, 300, 299, 301, 7, 13, 88, 97, 210, 219, 444, 455, 512, 523, 66, 74, 380, 391,
  ];
  const swept: number[] = [];
  for (let frame = 20; frame < 590 && handPicked.length + swept.length < 130; frame += 5) {
    if (!handPicked.includes(frame)) swept.push(frame);
  }
  return [...handPicked, ...swept];
})();

export default function SpikeScreen() {
  const { width, height, scale, fontScale } = useWindowDimensions();
  const clock = useRef<FrameClockHandle>(null);

  const [clipKey, setClipKey] = useState<ClipKey>("synthetic");
  const clip = CLIPS[clipKey];
  const [clipUri, setClipUri] = useState<string | null>(null);
  /** Set while a network probe runs; overrides the bundled clip as the player's source. */
  const [remoteSource, setRemoteSource] = useState<string | null>(null);
  const [probes, setProbes] = useState<Probe[]>(PROBES);
  const [ready, setReady] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The frame the overlay is currently drawn for. Drives the marker AND the drift report. */
  const [overlayFrame, setOverlayFrame] = useState(0);
  /** Measured, not computed from window width — padding changes must not silently desync this. */
  const [videoWidth, setVideoWidth] = useState(0);
  /** Free-run playback for eyeballing the marker against the bar, and for the screenshot-based
   *  measurement in scripts/measure_overlay.py, which needs more than a probe's 5s to sample. */
  const [looping, setLooping] = useState(false);
  const measuring = useRef(false);
  /**
   * Which overlay paint path is being measured (D34).
   *
   *   "react-state"  the frame event sets React state, an effect marks the overlay after commit.
   *                  This is what produced D34's p50 = -1, and it is the architecture
   *                  apps/web/src/lib/usePlayer.ts abandoned for exactly that reason.
   *   "sync-ack"     the frame event marks the overlay SYNCHRONOUSLY, drawing nothing. This is the
   *                  platform CEILING: the best a JS-driven overlay could ever do on this device.
   *                  If it cannot reach zero, no renderer can save it and D5 is genuinely in
   *                  question; if it can, the renderer is the suspect and Skia is the next probe.
   *
   * Keeping both rather than replacing is the point — a ceiling is only meaningful next to the
   * baseline it improves on.
   */
  const paintStrategy = useRef<"react-state" | "sync-ack">("react-state");
  /** Set while the draw-then-seek scrub runs, so the commit effect does not mark a second time. */
  const drawFirstRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setClipUri(null);
    setReady(null);
    Asset.fromModule(clip.module)
      .downloadAsync()
      .then((asset) => {
        if (!cancelled) setClipUri(asset.localUri ?? asset.uri);
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [clip.module]);

  // Name -> index once per bundle. The order is never assumed: it comes from the artifact.
  const poseIndex = useMemo(
    () => (clip.pose ? buildIndex(clip.pose.keypointNames) : {}),
    [clip.pose],
  );
  const poseFrame = useMemo(
    () => (clip.pose ? frameAt(clip.pose, overlayFrame) : null),
    [clip.pose, overlayFrame],
  );


  /**
   * Report the commit back to native, which scores it against the frame actually on the glass.
   *
   * `useEffect` after a state change is the closest hook React Native gives to "the overlay is
   * committed". It is not the same instant as the pixels reaching the display, and that gap is
   * part of what the number measures — which is the honest position, since the same gap is what a
   * real overlay would suffer.
   */
  useEffect(() => {
    if (!measuring.current || paintStrategy.current !== "react-state") return;
    if (drawFirstRef.current) return; // the scrub probe already marked this frame itself
    void clock.current?.markOverlayCommitted(overlayFrame);
  }, [overlayFrame]);

  /**
   * Apply a patch AND, once a probe reaches a terminal state, emit it to logcat so the number
   * outlives the screen. Recording here rather than at each call site means a probe added later
   * cannot forget to do it.
   */
  const setProbe = useCallback((id: string, patch: Partial<Probe>) => {
    setProbes((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      const changed = next.find((p) => p.id === id);
      if (changed && (changed.status === "pass" || changed.status === "fail")) {
        recordResult(changed);
      }
      return next;
    });
  }, []);

  const deviceName = `${Platform.OS} ${String(Platform.Version)}`;

  const runOverlayProbe = useCallback(async (
    strategy: "react-state" | "sync-ack" = "react-state",
  ) => {
    const handle = clock.current;
    if (!handle || busy) return;
    setBusy(true);
    const probeId = strategy === "sync-ack" ? "overlay-ceiling" : "overlay-sync";
    setProbe(probeId, { status: "running" as ProbeStatus, measurement: undefined });

    paintStrategy.current = strategy;
    await handle.resetStats();
    measuring.current = true;
    await handle.seekToFrame(0);
    await handle.play();

    await new Promise((r) => setTimeout(r, OVERLAY_RUN_MS));

    measuring.current = false;
    await handle.pause();
    const stats: FrameClockStats = await handle.getStats();
    const verdict = judgeOverlayDrift(stats.overlayDriftFrames);

    setProbe(probeId, {
      status: verdict.status,
      measurement: { value: verdict.value, device: deviceName },
      detail:
        `${verdict.detail} · JS lead p95 ${stats.leadTimeMs.p95.toFixed(1)}ms · ` +
        `paint=${strategy}`,
    });
    paintStrategy.current = "react-state";
    setBusy(false);
  }, [busy, deviceName, setProbe]);

  const runSeekProbe = useCallback(async () => {
    const handle = clock.current;
    if (!handle || busy) return;
    setBusy(true);
    setProbe("seek", { status: "running" as ProbeStatus, measurement: undefined });

    await handle.pause();
    await handle.resetStats();

    for (const target of SEEK_TARGETS) {
      await handle.seekToFrame(target);
      // Let the seek settle and a frame reach the screen before asking for the next one.
      await new Promise((r) => setTimeout(r, 250));
    }

    const stats: FrameClockStats = await handle.getStats();
    const verdict = judgeSeekError(stats.seekErrorFrames);

    setProbe("seek", {
      status: verdict.status,
      measurement: { value: verdict.value, device: deviceName },
      detail: verdict.detail,
    });
    setBusy(false);
  }, [busy, deviceName, setProbe]);

  /**
   * Probe 2b: drag the scrubber, do not just seek to a list of targets.
   *
   * A drag is not a sequence of settled seeks. It is a stream of them arriving faster than the
   * decoder can finish, each landing mid-GOP, and the overlay has to track the frames that
   * actually reach the screen rather than the ones that were requested. Stepping politely
   * through targets with a wait in between — which is what probe 2 does — measures seek accuracy
   * and says nothing about this.
   */
  /**
   * Probe 3 records; the VERDICT is computed on the PC from the file itself
   * (`scripts/measure-capture.mjs`). The camera cannot be the witness for whether the camera
   * degraded, so this side only reports what was requested and where the artifact landed.
   */
  const onCaptureRecorded = useCallback((info: {
    path: string; requestedFps: number; resolvedFps: number; seconds: number; supported: number[];
  }) => {
    setProbe("capture", {
      status: "fail",
      measurement: { value: info.requestedFps, device: deviceName },
      detail:
        `recorded ${info.seconds.toFixed(1)}s, REQUESTED ${info.requestedFps}fps, ` +
        `pipeline negotiated ${info.resolvedFps || "?"}fps, device claims ` +
        `[${info.supported.join("/")}] -> ${info.path} · ` +
        `run: node scripts/measure-capture.mjs --expect ${info.requestedFps}`,
    });
  }, [deviceName, setProbe]);

  const onCaptureError = useCallback((message: string) => {
    setProbe("capture", {
      status: "fail",
      measurement: { value: 0, device: deviceName },
      detail: `capture failed: ${message}`,
    });
  }, [deviceName, setProbe]);

  /**
   * Probe 4 — the same seek measurement, against a clip arriving over HTTP.
   *
   * Reuses SEEK_TARGETS unchanged so the streaming number is directly comparable with the bundled
   * one; a difference between them is the network's contribution and nothing else.
   */
  const runRemoteSeekProbe = useCallback(async () => {
    const handle = clock.current;
    if (!handle || busy) return;
    setBusy(true);
    setProbe("remote-seek", { status: "running" as ProbeStatus, measurement: undefined });

    setRemoteSource(`${FIXTURE_ORIGIN}/assets/frameclock.mp4`);
    // Let the player rebuild against the network source and buffer before asking for a seek.
    await new Promise((r) => setTimeout(r, 4_000));

    await handle.pause();
    await handle.resetStats();
    for (const target of SEEK_TARGETS) {
      await handle.seekToFrame(target);
      await new Promise((r) => setTimeout(r, 250));
    }
    const stats: FrameClockStats = await handle.getStats();
    const verdict = judgeSeekError(stats.seekErrorFrames);

    setProbe("remote-seek", {
      status: verdict.status,
      measurement: { value: verdict.value, device: deviceName },
      detail: `${verdict.detail} · source=network`,
    });
    setRemoteSource(null);
    setBusy(false);
  }, [busy, deviceName, setProbe]);

  /** Probe 5 — download and parse the largest real artifact, timed on the device. */
  const runArtifactProbe = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProbe("artifact-weight", { status: "running" as ProbeStatus, measurement: undefined });

    try {
      const t0 = Date.now();
      const res = await fetch(`${FIXTURE_ORIGIN}/out/pro_3/analysis.json`);
      const text = await res.text();
      const t1 = Date.now();
      // JSON.parse, not res.json(), so download and parse are timed separately — they have
      // different fixes and a combined number would hide which one is the problem.
      const parsed = JSON.parse(text) as { pose?: { frames?: unknown[] } };
      const t2 = Date.now();

      const verdict = judgeArtifact(text.length, t1 - t0, t2 - t1);
      setProbe("artifact-weight", {
        status: verdict.status,
        measurement: { value: verdict.value, device: deviceName },
        detail: `${verdict.detail} · ${parsed.pose?.frames?.length ?? 0} pose frames`,
      });
    } catch (err) {
      setProbe("artifact-weight", {
        status: "fail",
        measurement: { value: 0, device: deviceName },
        detail: `could not reach ${FIXTURE_ORIGIN} — is scripts/serve-fixtures.mjs running? ` +
          `${err instanceof Error ? err.message : String(err)}`,
      });
    }
    setBusy(false);
  }, [busy, deviceName, setProbe]);

  /**
   * @param drawFirst  Draw the overlay for the TARGET frame before asking for the seek, instead
   *                   of waiting to be told a frame arrived.
   *
   * The reactive order is what the playback path uses and it cannot work here: a seeked frame is
   * displayed essentially on arrival, so there is no lead to draw inside — measured 0.0% locked,
   * p95 25 frames. But during a scrub the app already KNOWS the target; it chose it. Committing
   * the overlay first and seeking second removes the round-trip from the critical path entirely.
   */
  const runScrubProbe = useCallback(async (drawFirst = false) => {
    const handle = clock.current;
    if (!handle || busy) return;
    setBusy(true);
    const probeId = drawFirst ? "scrub-draw-first" : "scrub";
    setProbe(probeId, { status: "running" as ProbeStatus, measurement: undefined });

    setLooping(false);
    await handle.pause();
    await handle.resetStats();
    measuring.current = true;
    drawFirstRef.current = drawFirst;

    // Sweep back and forth across the clip at roughly a finger's speed, without waiting for any
    // seek to settle. 16ms between requests is deliberately faster than the decoder can serve.
    const span = clip.frames - 1;
    for (let pass = 0; pass < 3; pass += 1) {
      for (let t = 0; t <= 1; t += 0.02) {
        const target = Math.round((pass % 2 === 0 ? t : 1 - t) * span);
        if (drawFirst) {
          setOverlayFrame(target);
          void handle.markOverlayCommitted(target);
        }
        void handle.seekToFrame(target);
        await new Promise((r) => setTimeout(r, 16));
      }
    }
    // Let the last seek land before reading, or the final sample scores a frame still in flight.
    await new Promise((r) => setTimeout(r, 300));

    measuring.current = false;
    drawFirstRef.current = false;
    const stats: FrameClockStats = await handle.getStats();
    const verdict = judgeOverlayDrift(stats.overlayDriftFrames);
    setProbe(probeId, {
      status: verdict.status,
      measurement: { value: verdict.value, device: deviceName },
      detail: `${verdict.detail} · order=${drawFirst ? "draw-then-seek" : "seek-then-react"}`,
    });
    setBusy(false);
  }, [busy, clip.frames, deviceName, setProbe]);

  // The marker mirrors the clip's burned-in sweeping bar. If the two do not sit on top of each
  // other on a screen recording, something is wrong — this is the Gate 3 check, on the phone.
  //
  // Worked in the CLIP's pixel space and then scaled to however wide the video actually rendered.
  // The bar's left edge is (CLIP_WIDTH - BAR_WIDTH) * n / (frames - 1); add half the bar to get
  // its centre, then subtract half the marker so the two centres coincide.
  const barCentreInClipPx =
    ((CLIP_WIDTH_PX - BAR_WIDTH_PX) * overlayFrame) / (clip.frames - 1) + BAR_WIDTH_PX / 2;
  const markerLeft =
    (barCentreInClipPx * videoWidth) / CLIP_WIDTH_PX - MARKER_WIDTH / 2;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>SWINGSAGE · PLATFORM FOUNDATION</Text>
        <Text style={styles.h1}>Step 02 spike</Text>
        <Text style={styles.lede}>
          Not the product. Three questions that decide whether the framework choice holds —
          answered on real hardware, Android first.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Device</Text>
          <Row k="Platform" v={deviceName} />
          <Row k="Screen" v={`${Math.round(width)}×${Math.round(height)} @${scale}x`} />
          <Row k="Font scale" v={fontScale.toFixed(2)} />
          <Row k="Clip" v={ready ?? (clipUri ? "loading…" : "resolving asset…")} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={styles.videoCard}>
          <View style={styles.transport}>
            {(Object.keys(CLIPS) as ClipKey[]).map((k) => (
              <Pressable
                key={k}
                style={[styles.transportButton, k === clipKey && styles.transportActive]}
                onPress={() => {
                  setLooping(false);
                  setClipKey(k);
                }}
              >
                <Text style={styles.transportText}>{CLIPS[k].label}</Text>
              </Pressable>
            ))}
          </View>
          <View
            style={styles.videoWrap}
            onLayout={(e) => setVideoWidth(e.nativeEvent.layout.width)}
          >
            <FrameClockView
              ref={clock}
              style={styles.video}
              source={remoteSource ?? clipUri}
              fps={clip.fps}
              // Always on here, even though the module defaults it off. The overlay marker IS
              // driven by these events, so this is not instrumentation sitting beside the thing
              // under test — it is the architecture under test. Turning it on only while
              // measuring would measure a code path the product would never ship.
              emitFrames
              surfaceType="textureView"
              onReady={({ nativeEvent }) => {
                setReady(
                  `${nativeEvent.width}×${nativeEvent.height} · container ${nativeEvent.containerFps.toFixed(2)}fps`,
                );
              }}
              onPlayerError={({ nativeEvent }) => setError(nativeEvent.message)}
              onFrameRendered={({ nativeEvent }) => {
                // Marked here, before React hears about the frame at all. This is the whole
                // difference the ceiling probe measures: no Scheduler task, no commit, no effect.
                if (measuring.current && paintStrategy.current === "sync-ack") {
                  void clock.current?.markOverlayCommitted(nativeEvent.frame);
                }
                setOverlayFrame(nativeEvent.frame);
                if (looping && nativeEvent.frame >= clip.frames - 2) {
                  void clock.current?.seekToFrame(0);
                }
              }}
            />
            {/* The real overlay, when a clip carries pose data. This is the workload the cost
                comparison is about — see Skeleton.tsx for why it is drawn with plain Views. */}
            {videoWidth > 0 && clip.pose ? (
              <Skeleton
                frame={poseFrame}
                width={videoWidth}
                height={(videoWidth * 16) / 9}
                index={poseIndex}
                names={clip.pose.keypointNames}
              />
            ) : null}
            {/* The JS overlay. Should sit exactly on the clip's own green bar. */}
            {videoWidth > 0 ? (
              <>
                <View
                  pointerEvents="none"
                  style={[styles.marker, { left: markerLeft, width: MARKER_WIDTH }]}
                />
                {/* Calibration ticks at the video's exact left and right edges.
                    scripts/measure_overlay.py needs the rendered video width to convert a pixel
                    gap into frames, and it cannot infer it: the clip is 9:16 and taller than the
                    screen, so the visible height is clipped and height x 9/16 is not the width.
                    Letting the app state its own geometry beats the script guessing at it. */}
                <View pointerEvents="none" style={[styles.calTick, { left: 0 }]} />
                <View
                  pointerEvents="none"
                  style={[styles.calTick, { left: videoWidth - CAL_TICK_WIDTH }]}
                />
              </>
            ) : null}
          </View>
          <View style={styles.transport}>
            <Pressable
              style={styles.transportButton}
              onPress={() => {
                setLooping(true);
                void clock.current?.play();
              }}
            >
              <Text style={styles.transportText}>Play (loop)</Text>
            </Pressable>
            <Pressable
              style={styles.transportButton}
              onPress={() => {
                setLooping(false);
                void clock.current?.pause();
              }}
            >
              <Text style={styles.transportText}>Pause</Text>
            </Pressable>
          </View>
          <Text style={styles.detail}>
            Frame {overlayFrame} · {clip.blurb}
          </Text>
          <Text style={styles.detail}>
            The white marker is drawn by JS, the green bar is burned into the video. Any gap
            between them IS the drift.
          </Text>
        </View>

        {probes.map((p) => (
          <ProbeCard
            key={p.id}
            probe={p}
            onRun={
              p.id === "overlay-sync"
                ? () => runOverlayProbe("react-state")
                : p.id === "overlay-ceiling"
                  ? () => runOverlayProbe("sync-ack")
                  : p.id === "seek"
                    ? runSeekProbe
                    : p.id === "scrub"
                      ? () => runScrubProbe(false)
                      : p.id === "scrub-draw-first"
                        ? () => runScrubProbe(true)
                        : p.id === "remote-seek"
                          ? runRemoteSeekProbe
                          : p.id === "artifact-weight"
                            ? runArtifactProbe
                            : undefined
            }
            disabled={busy || !clipUri}
          >
            {p.id === "capture" ? (
              <CaptureProbe
                onRecorded={onCaptureRecorded}
                onError={onCaptureError}
                disabled={busy}
              />
            ) : null}
          </ProbeCard>
        ))}

        <Text style={styles.footer}>
          Probe 3 needs a camera path that can request 60fps; it is third because probes 1 and 2
          carry the risk that could invalidate D5. See docs/RUNBOOK.md §6.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowK}>{k}</Text>
      <Text style={styles.rowV}>{v}</Text>
    </View>
  );
}
