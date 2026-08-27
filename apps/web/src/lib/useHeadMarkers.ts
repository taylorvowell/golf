"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** A hand-placed club head, normalized 0–1 against the video frame. */
export interface HeadMarker { frame: number; x: number; y: number }

export interface HeadMarkers {
  /** Every saved-or-pending marker, by frame. */
  byFrame: Map<number, HeadMarker>;
  /** Editing mode is on. Clicking the picture places the head for the current frame. */
  editing: boolean;
  setEditing: (v: boolean) => void;
  /** Place (or move) the head on `frame`. */
  place: (frame: number, x: number, y: number) => void;
  /** Drop the manual position on `frame`, falling back to whatever the analyzer produced. */
  clear: (frame: number) => void;
  /** Drop every manual position on the swing. */
  clearAll: () => void;
  /** Frames placed or moved since the last save, and frames cleared since the last save.
   * Exposed as sets, not just a count, because the list draws a per-frame saved/unsaved
   * state — see `HeadMarkerBar`'s dot. */
  dirty: Set<number>;
  removedFrames: Set<number>;
  /** Frames edited since the last save — `dirty.size + removedFrames.size`. */
  pending: number;
  save: () => void;
  saving: boolean;
  error: string | null;
}

/**
 * Hand-placed club-head positions for one swing, loaded from and saved to
 * `/api/v1/swings/:id/markers`.
 *
 * Edits are held locally and written in one batch, not per click. Placing a head is a fiddly
 * pointing task — you nudge it several times before it is right — and a request per nudge would
 * make the stored position depend on which response landed last. It also keeps an editing
 * session cheap enough to work frame by frame without thinking about the network.
 *
 * The markers deliberately live outside `analysis.json`: that file is regenerated wholesale by
 * every re-analysis, so a correction written into it would be destroyed by the next run. Here a
 * re-analysis improves the automatic path underneath the corrections while every hand-placed
 * position survives.
 */
export function useHeadMarkers(swingId: string): HeadMarkers {
  const [byFrame, setByFrame] = useState<Map<number, HeadMarker>>(() => new Map());
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which frames changed since the last save, split by what the save has to do with them.
  //
  // State rather than refs: the list marks each row as saved or not, so these have to drive a
  // render. That costs nothing extra — every path that mutates them already calls `setByFrame`
  // in the same tick, so the render was happening anyway. `removedRef` mirrors the deletions
  // for the one reader that cannot see state: the load effect below, which resolves a fetch
  // that was already in flight when the edit was made.
  const [dirty, setDirty] = useState<Set<number>>(() => new Set());
  const [removed, setRemoved] = useState<Set<number>>(() => new Set());
  const removedRef = useRef(removed);
  useEffect(() => { removedRef.current = removed; }, [removed]);
  const pending = dirty.size + removed.size;

  // Load once per swing. Any edits made before the response lands would be overwritten by it,
  // so the merge keeps the local entry: the user's click is newer than the fetch that was
  // already in flight when they made it.
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/v1/swings/${swingId}/markers`, { cache: "no-store", signal: ac.signal })
      .then((r) => r.json())
      .then((d: { markers?: (HeadMarker & { stale?: true })[] }) => {
        setByFrame((cur) => {
          // Stale rows (placed against a different artifact clock — a re-analysis changed
          // the fps, C10) are hidden, never merged: their frame numbers name the wrong
          // instant on this clip. They survive on the server; re-placing a head on the
          // frame re-stamps it against the current clock.
          const next = new Map(
            (d.markers ?? [])
              .filter((m) => !m.stale)
              .map((m) => [m.frame, { frame: m.frame, x: m.x, y: m.y }] as const),
          );
          for (const [f, m] of cur) next.set(f, m);
          for (const f of removedRef.current) next.delete(f);
          return next;
        });
      })
      .catch((e: Error) => { if (e.name !== "AbortError") setError("could not load markers"); });
    return () => ac.abort();
  }, [swingId]);

  const place = useCallback((frame: number, x: number, y: number) => {
    // Clamped to the picture. Pointer capture keeps delivering moves after the cursor leaves
    // the frame, so a drag that overshoots would otherwise store a head at x = 1.14 — outside
    // the video, and outside `analysis.json`'s normalized 0–1 contract that every consumer of
    // these coordinates assumes. Clamping at the one place positions are written keeps the
    // guarantee whatever calls it.
    const cx = Math.min(1, Math.max(0, x));
    const cy = Math.min(1, Math.max(0, y));
    setByFrame((cur) => {
      const next = new Map(cur);
      next.set(frame, { frame, x: cx, y: cy });
      return next;
    });
    setDirty((cur) => (cur.has(frame) ? cur : new Set(cur).add(frame)));
    setRemoved((cur) => {
      if (!cur.has(frame)) return cur;
      const next = new Set(cur);
      next.delete(frame);
      return next;
    });
  }, []);

  // `clear`/`clearAll` read `byFrame` from the closure rather than using a functional update,
  // the way `save` already does: both have to know what was actually placed before deciding
  // what to record for the next save, and that decision cannot live inside a state updater
  // without putting a side effect in one.
  const clear = useCallback((frame: number) => {
    // Nothing placed here, nothing to clear — and nothing to record. Recording it anyway would
    // leave a phantom "1 unsaved" and send a DELETE for a row that never existed.
    if (!byFrame.has(frame)) return;
    setByFrame((cur) => {
      const next = new Map(cur);
      next.delete(frame);
      return next;
    });
    setDirty((cur) => {
      if (!cur.has(frame)) return cur;
      const next = new Set(cur);
      next.delete(frame);
      return next;
    });
    // Only worth a DELETE if it could be on the server. A frame placed and cleared inside one
    // editing session never existed there.
    setRemoved((cur) => (cur.has(frame) ? cur : new Set(cur).add(frame)));
  }, [byFrame]);

  /** Drop every hand-placed head, reverting the whole swing to the analyzer's tracked path. */
  const clearAll = useCallback(() => {
    if (!byFrame.size) return;
    setDirty((cur) => {
      const next = new Set(cur);
      for (const f of byFrame.keys()) next.delete(f);
      return next;
    });
    setRemoved((cur) => {
      const next = new Set(cur);
      for (const f of byFrame.keys()) next.add(f);
      return next;
    });
    setByFrame(new Map());
  }, [byFrame]);

  const save = useCallback(() => {
    const markers = [...dirty].map((f) => byFrame.get(f)).filter(Boolean) as HeadMarker[];
    const deleted = [...removed];
    if (!markers.length && !deleted.length) return;
    setSaving(true);
    setError(null);
    fetch(`/api/v1/swings/${swingId}/markers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markers, deleted }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        // Only the frames this request carried. An edit made while it was in flight is still
        // unsaved, and clearing the whole set would drop it silently.
        setDirty((cur) => {
          const next = new Set(cur);
          for (const m of markers) next.delete(m.frame);
          return next;
        });
        setRemoved((cur) => {
          const next = new Set(cur);
          for (const f of deleted) next.delete(f);
          return next;
        });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  }, [byFrame, dirty, removed, swingId]);

  return useMemo(() => ({
    byFrame, editing, setEditing, place, clear, clearAll,
    dirty, removedFrames: removed, pending, save, saving, error,
  }), [byFrame, editing, place, clear, clearAll, dirty, removed, pending, save, saving, error]);
}
