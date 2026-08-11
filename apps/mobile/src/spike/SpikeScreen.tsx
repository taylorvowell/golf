import { Asset } from "expo-asset";
import { useCallback, useEffect, useRef, useState } from "react";
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
import type { FrameClockHandle, FrameClockStats } from "../../modules/frame-clock/src/FrameClock.types";
import { ProbeCard } from "./ProbeCard";
import {
  PROBES,
  judgeOverlayDrift,
  judgeSeekError,
  type Probe,
  type ProbeStatus,
} from "./probes";
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

/** The reference clip: 600 frames, exactly 60fps CFR, GOP 10, frame number burned in. */
const CLIP = require("../../assets/frameclock.mp4");
const CLIP_FPS = 60;
const CLIP_FRAMES = 600;

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

/** How long the overlay-sync probe plays for. 5s at 60fps is ~300 samples, over the n≥120 bar. */
const OVERLAY_RUN_MS = 5_000;

/**
 * Seek targets for probe 2.
 *
 * Fixed rather than random so a re-run is comparable, and chosen to land in every position
 * relative to the GOP of 10 — on a keyframe (150, 300), one frame after one (151), and one frame
 * before the next (149, 299). Android decodes-and-skips from the preceding sync point, so a
 * target just before a keyframe is the worst case and has to be in the set or the probe measures
 * only the easy half of the problem.
 */
const SEEK_TARGETS = [
  150, 151, 149, 300, 299, 301, 7, 13, 88, 97, 210, 219, 444, 455, 512, 523, 66, 74, 380, 391,
];

export default function SpikeScreen() {
  const { width, height, scale, fontScale } = useWindowDimensions();
  const clock = useRef<FrameClockHandle>(null);

  const [clipUri, setClipUri] = useState<string | null>(null);
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

  useEffect(() => {
    Asset.fromModule(CLIP)
      .downloadAsync()
      .then((asset) => setClipUri(asset.localUri ?? asset.uri))
      .catch((e: unknown) => setError(String(e)));
  }, []);

  /**
   * Report the commit back to native, which scores it against the frame actually on the glass.
   *
   * `useEffect` after a state change is the closest hook React Native gives to "the overlay is
   * committed". It is not the same instant as the pixels reaching the display, and that gap is
   * part of what the number measures — which is the honest position, since the same gap is what a
   * real overlay would suffer.
   */
  useEffect(() => {
    if (!measuring.current) return;
    void clock.current?.markOverlayCommitted(overlayFrame);
  }, [overlayFrame]);

  const setProbe = useCallback((id: string, patch: Partial<Probe>) => {
    setProbes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const deviceName = `${Platform.OS} ${String(Platform.Version)}`;

  const runOverlayProbe = useCallback(async () => {
    const handle = clock.current;
    if (!handle || busy) return;
    setBusy(true);
    setProbe("overlay-sync", { status: "running" as ProbeStatus, measurement: undefined });

    await handle.resetStats();
    measuring.current = true;
    await handle.seekToFrame(0);
    await handle.play();

    await new Promise((r) => setTimeout(r, OVERLAY_RUN_MS));

    measuring.current = false;
    await handle.pause();
    const stats: FrameClockStats = await handle.getStats();
    const verdict = judgeOverlayDrift(stats.overlayDriftFrames);

    setProbe("overlay-sync", {
      status: verdict.status,
      measurement: { value: verdict.value, device: deviceName },
      detail: `${verdict.detail} · JS lead p95 ${stats.leadTimeMs.p95.toFixed(1)}ms`,
    });
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

  // The marker mirrors the clip's burned-in sweeping bar. If the two do not sit on top of each
  // other on a screen recording, something is wrong — this is the Gate 3 check, on the phone.
  //
  // Worked in the CLIP's pixel space and then scaled to however wide the video actually rendered.
  // The bar's left edge is (CLIP_WIDTH - BAR_WIDTH) * n / (frames - 1); add half the bar to get
  // its centre, then subtract half the marker so the two centres coincide.
  const barCentreInClipPx =
    ((CLIP_WIDTH_PX - BAR_WIDTH_PX) * overlayFrame) / (CLIP_FRAMES - 1) + BAR_WIDTH_PX / 2;
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
          <View
            style={styles.videoWrap}
            onLayout={(e) => setVideoWidth(e.nativeEvent.layout.width)}
          >
            <FrameClockView
              ref={clock}
              style={styles.video}
              source={clipUri}
              fps={CLIP_FPS}
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
                setOverlayFrame(nativeEvent.frame);
                if (looping && nativeEvent.frame >= CLIP_FRAMES - 2) {
                  void clock.current?.seekToFrame(0);
                }
              }}
            />
            {/* The JS overlay. Should sit exactly on the clip's own green bar. */}
            {videoWidth > 0 ? (
              <View
                pointerEvents="none"
                style={[styles.marker, { left: markerLeft, width: MARKER_WIDTH }]}
              />
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
            Overlay frame {overlayFrame} · the white marker is drawn by JS, the green bar is burned
            into the video. Any gap between them IS the drift.
          </Text>
        </View>

        {probes.map((p) => (
          <ProbeCard
            key={p.id}
            probe={p}
            onRun={
              p.id === "overlay-sync" ? runOverlayProbe : p.id === "seek" ? runSeekProbe : undefined
            }
            disabled={busy || !clipUri}
          />
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
