"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Axis = "x" | "y" | "both";

/**
 * Click-and-drag panning for a scroll container, plus an honest "this actually overflows"
 * flag for the affordance next to it.
 *
 * The angle table is ten checkpoint columns wide and the checkpoint rail is eleven cards
 * wide, so both are permanently wider than the panel holding them. On a trackpad a
 * two-finger swipe pans them; on a mouse the only native gesture is shift+wheel, which
 * nobody discovers, and Chrome's overlay scrollbar only appears once you are already
 * scrolling. Grabbing the content and pulling is the gesture people try first.
 *
 * Two details are what make it safe to put over a table made almost entirely of buttons:
 *
 *  * **Nothing happens until the pointer passes `THRESHOLD`.** Below that it is still a
 *    click, so the angle names and the column headers keep working exactly as before.
 *  * **Once it is a drag, the click that ends it is swallowed** in the capture phase.
 *    Releasing over a column header would otherwise seek the video to that frame, which
 *    reads as the page jumping on its own.
 *
 * Touch and pen are left alone deliberately — they already pan natively, with momentum and
 * rubber-banding we would only be approximating.
 */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>(axis: Axis = "x") {
  const ref = useRef<T>(null);
  const [canScroll, setCanScroll] = useState(false);

  const canX = axis !== "y";
  const canY = axis !== "x";

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScroll(
      (canX && el.scrollWidth - el.clientWidth > 1)
      || (canY && el.scrollHeight - el.clientHeight > 1),
    );
  }, [canX, canY]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let down = false;      // pointer is held, but may still turn out to be a click
    let panned = false;    // passed the threshold — this is a drag, not a click
    let pid = -1;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    const THRESHOLD = 4;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      // Text fields and links own their own drag semantics (caret selection, drag-to-open).
      if ((e.target as HTMLElement | null)?.closest("input, select, textarea, a[href]")) return;
      down = true;
      panned = false;
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      startLeft = el.scrollLeft; startTop = el.scrollTop;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!down || e.pointerId !== pid) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!panned) {
        const travelled = Math.max(canX ? Math.abs(dx) : 0, canY ? Math.abs(dy) : 0);
        if (travelled < THRESHOLD) return;
        panned = true;
        el.dataset.dragging = "true";
        // The mousedown already started a selection; `user-select: none` arriving now only
        // stops it growing, so drop what has been selected as the drag takes over.
        window.getSelection()?.removeAllRanges();
      }
      if (canX) el.scrollLeft = startLeft - dx;
      if (canY) el.scrollTop = startTop - dy;
    };

    // Window-level, so a drag that leaves the container still ends cleanly.
    const onPointerUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== pid) return;
      down = false;
      pid = -1;
      delete el.dataset.dragging;
      // `panned` survives until the click it produced has been swallowed below, or until
      // the next pointerdown resets it — whichever comes first.
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!panned) return;
      panned = false;
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("click", onClickCapture, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      delete el.dataset.dragging;
    };
  }, [canX, canY]);

  // Overflow depends on the panel's width and on how many rows/columns the analysis produced,
  // and both can change after mount (tab switch, "show N fields not measurable in this view").
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, canScroll, measure };
}
