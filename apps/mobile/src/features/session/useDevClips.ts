import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import HighSpeedCamera, {
  type DevClip,
} from "../../../modules/high-speed-camera/src";
import { useDebugGroups } from "../debug/DebugOverlay";
import {
  loadDevClipMarks,
  markFor,
  saveDevClipMarks,
  type DevClipMarks,
} from "./devClipMarks";
import type { CaptureView, SessionAction } from "./sessionState";
import type { DebugGroup } from "./sheets/DebugSheet";

/**
 * The dev clip drawer: pre-recorded swings offered as if the camera had just shot them.
 *
 * **Why this exercises the real path rather than short-cutting it.** The clips are filmed the
 * way a golfer actually films alone — start the recording, walk to the ball, hit, walk back,
 * stop — which is precisely the long, mostly-empty take the mark-the-strike screen exists to
 * cut down. Injecting one lands on that screen with a genuinely hard input, so the filmstrip,
 * the audio seed, the scrub and the trim all get tested. What it does NOT prove is that the
 * camera can produce such a take; only the range proves that.
 *
 * It is also the project's only source of **front-view footage**. Every fixture is
 * down-the-line, so every view-gated and mirroring path is untested against real film; a
 * face-on clip injected here is the first time that half of the pipeline sees a real frame.
 *
 * The files live outside the app's cache (`devClipFolders` in the native module) so the
 * capture-cache sweep can never reach them, and both Save and Delete refuse to unlink a take
 * flagged `dev` — a debug convenience that quietly eats a clip library is worse than none.
 */

export interface DevClipRow extends DevClip {
  status: "new" | "tried" | "saved";
  view: CaptureView;
  /** A single frame from the middle of the clip — absent until it has been decoded. */
  thumbUri?: string;
}

export interface DevClipsDrawer {
  open: boolean;
  setOpen: (open: boolean) => void;
  rows: DevClipRow[];
  folder: string | null;
  /** Inject a clip as a finished take — lands on the review screen. */
  inject: (row: DevClipRow) => void;
  /** Correct the angle a clip was filmed from. Persisted. */
  setView: (row: DevClipRow, view: CaptureView) => void;
  /** A dev clip reached a saved swing — the verdict worth keeping. Path, not name: the save
   * path only ever holds the take's path. */
  markSaved: (path: string) => void;
  rescan: () => void;
}

/** Wide enough to recognise a clip by, small enough that a dozen decode without a pause. */
const THUMB_WIDTH = 220;

export function useDevClips(dispatch: (action: SessionAction) => void): DevClipsDrawer {
  const [open, setOpen] = useState(false);
  const [clips, setClips] = useState<DevClip[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [marks, setMarks] = useState<DevClipMarks>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const rescan = useCallback(() => {
    if (!__DEV__) return;
    void HighSpeedCamera.devClips?.()
      .then((listing) => {
        setFolder(listing.folder || null);
        setClips(listing.clips);
      })
      // A drawer that cannot list is an empty drawer, never an error thrown at a developer who
      // was in the middle of something else.
      .catch(() => setClips([]));
  }, []);

  useEffect(rescan, [rescan]);
  useEffect(() => {
    if (__DEV__) void loadDevClipMarks().then(setMarks);
  }, []);

  /**
   * One frame per clip, decoded only once the drawer has been opened.
   *
   * Twenty 1080p keyframe decodes on session-mode mount would be paid by every golfer entering
   * capture, for a panel most of them never open. The ref makes it once-ever per path rather
   * than once per render pass.
   */
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!__DEV__ || !open) return;
    for (const clip of clips) {
      if (requested.current.has(clip.path)) continue;
      requested.current.add(clip.path);
      void HighSpeedCamera.clipThumbnails?.(clip.path, 1, THUMB_WIDTH)
        .then((frames) => {
          const first = frames[0];
          if (first) setThumbs((prev) => ({ ...prev, [clip.path]: `file://${first.path}` }));
        })
        // An unreadable clip simply has no picture in the row; the name still identifies it.
        .catch(() => {});
    }
  }, [clips, open]);

  const write = useCallback((next: DevClipMarks) => {
    setMarks(next);
    void saveDevClipMarks(next);
  }, []);

  const rows = useMemo<DevClipRow[]>(
    () =>
      clips.map((clip) => {
        const mark = markFor(marks, clip.name);
        return { ...clip, status: mark.status, view: mark.view, thumbUri: thumbs[clip.path] };
      }),
    [clips, marks, thumbs],
  );

  const inject = useCallback(
    (row: DevClipRow) => {
      // Tried the moment it is injected, not when review is dismissed: the verdict the drawer
      // records is "I have looked at this one", and that is true as soon as it opens.
      write({ ...marks, [row.name]: { status: markFor(marks, row.name).status === "saved" ? "saved" : "tried", view: row.view } });
      setOpen(false);
      dispatch({
        type: "dev-take",
        take: {
          path: row.path,
          fps: row.fps,
          durationMs: row.durationMs,
          // Only when the sensor genuinely outran the container. An ordinary recording reports
          // no capture rate at all, and must not be scaled by a ratio against zero.
          slowMoFactor: row.captureFps > row.fps ? row.captureFps / row.fps : 1,
        },
        view: row.view,
      });
    },
    [dispatch, marks, write],
  );

  const setView = useCallback(
    (row: DevClipRow, view: CaptureView) => {
      write({ ...marks, [row.name]: { status: markFor(marks, row.name).status, view } });
    },
    [marks, write],
  );

  /**
   * "Good enough to keep" — the one verdict only the review screen can reach, so it is written
   * from the save path rather than from the drawer. These are the clips worth putting through
   * the real pipeline.
   */
  const markSaved = useCallback(
    (path: string) => {
      const name = path.split("/").pop();
      if (!name) return;
      write({ ...marks, [name]: { ...markFor(marks, name), status: "saved" } });
    },
    [marks, write],
  );

  const groups = useMemo<DebugGroup[]>(() => {
    if (!__DEV__) return [];
    const untried = rows.filter((r) => r.status === "new").length;
    return [
      {
        title: "Pre-recorded clips",
        actions: [
          {
            key: "dev-clips-open",
            label: rows.length
              ? `Clip library — ${rows.length} clip${rows.length === 1 ? "" : "s"}, ${untried} untried`
              : "Clip library — none found",
            detail: folder ?? undefined,
            onPress: () => setOpen(true),
          },
        ],
      },
    ];
  }, [folder, rows]);

  useDebugGroups("session-dev-clips", groups);

  return { open, setOpen, rows, folder, inject, setView, markSaved, rescan };
}
