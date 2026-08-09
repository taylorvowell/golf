import { describe, expect, it } from "vitest";
import { playbackWindow, playbackPad } from "./playbackWindow";
import type { Analysis } from "./swings";

/**
 * The one-second rule: `playback_window` is pinned to `address − 1s … finish + 1s` so every
 * clip's lead-in and run-out are the same length. That is what lets two swings sit side by side
 * with the playhead meaning the same thing in both — the comparison view depends on it, and so
 * will the mobile player.
 *
 * These also cover the fallback path, which matters more than it looks: it is exact arithmetic
 * on published frame numbers for artifacts written before the analyzer computed the window
 * itself, and a client that quietly disagreed with the analyzer here would desynchronise a
 * comparison without any visible error.
 */

const FPS = 60;

function analysis(over: {
  frameCount?: number;
  address?: number;
  finish?: number;
  window?: [number, number] | null;
  pad?: [number, number] | null;
}): Analysis {
  const { frameCount = 400, address = 100, finish = 250, window = null, pad = null } = over;
  return {
    video: { frame_count: frameCount, fps: FPS },
    events: {
      address: { frame: address },
      finish: { frame: finish },
    },
    ...(window ? { playback_window: window } : {}),
    ...(pad ? { playback_pad: pad } : {}),
  } as unknown as Analysis;
}

describe("playbackWindow", () => {
  it("uses the analyzer's window when the artifact carries one", () => {
    expect(playbackWindow(analysis({ window: [40, 310] }))).toEqual([40, 310]);
  });

  it("clamps a stored window into the clip's real frame range", () => {
    // An artifact must never drive the player past the last frame that exists.
    expect(playbackWindow(analysis({ frameCount: 200, window: [-5, 9999] }))).toEqual([0, 199]);
  });

  it("falls back to address − 1s … finish + 1s when the artifact predates the field", () => {
    const [from, to] = playbackWindow(analysis({ address: 100, finish: 250 }));
    expect(from).toBe(100 - FPS);
    expect(to).toBe(250 + FPS);
  });

  it("clamps the fallback at both ends rather than going negative or past the end", () => {
    const [from, to] = playbackWindow(
      analysis({ frameCount: 200, address: 10, finish: 190 }),
    );
    expect(from).toBe(0);
    expect(to).toBe(199);
  });

  it("returns the whole clip when there are no events to derive from", () => {
    const a = { video: { frame_count: 300, fps: FPS } } as unknown as Analysis;
    expect(playbackWindow(a)).toEqual([0, 299]);
  });

  it("never returns an inverted or empty window", () => {
    for (const frameCount of [1, 2, 50, 400]) {
      for (const address of [0, 5, 40]) {
        const [from, to] = playbackWindow(
          analysis({ frameCount, address, finish: Math.min(address + 20, frameCount - 1) }),
        );
        expect(to).toBeGreaterThanOrEqual(from);
        expect(from).toBeGreaterThanOrEqual(0);
        expect(to).toBeLessThanOrEqual(Math.max(0, frameCount - 1));
      }
    }
  });
});

describe("playbackPad — the shortfall a clip cannot supply", () => {
  it("is zero when the clip has a full second on both sides", () => {
    expect(playbackPad(analysis({ address: 100, finish: 250 }))).toEqual([0, 0]);
  });

  it("reports the missing lead-in when the swing starts too early in the clip", () => {
    // swing2's real shape: Address at frame 41, which cannot supply the 60 frames it needs.
    const [lead, tail] = playbackPad(analysis({ frameCount: 400, address: 41, finish: 250 }));
    expect(lead).toBe(FPS - 41);
    expect(tail).toBe(0);
  });

  it("reports the missing run-out when the clip ends too soon after the finish", () => {
    const [lead, tail] = playbackPad(analysis({ frameCount: 200, address: 100, finish: 190 }));
    expect(tail).toBe(FPS - (199 - 190));
    expect(lead).toBe(0);
  });

  it("prefers the analyzer's stored pad over deriving one", () => {
    expect(playbackPad(analysis({ pad: [19, 4] }))).toEqual([19, 4]);
  });

  it("is never negative", () => {
    for (const address of [0, 1, 30, 59, 60, 200]) {
      const [lead, tail] = playbackPad(analysis({ address, finish: address + 100 }));
      expect(lead).toBeGreaterThanOrEqual(0);
      expect(tail).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("window and pad agree with each other", () => {
  it("pad is exactly what the window failed to include, at both ends", () => {
    for (const [frameCount, address, finish] of [
      [400, 100, 250],
      [200, 10, 150],
      [300, 41, 148],
      [120, 5, 100],
    ] as const) {
      const a = analysis({ frameCount, address, finish });
      const [from, to] = playbackWindow(a);
      const [lead, tail] = playbackPad(a);
      expect(lead).toBe(Math.max(0, FPS - (address - from)));
      expect(tail).toBe(Math.max(0, FPS - (to - finish)));
    }
  });
});
