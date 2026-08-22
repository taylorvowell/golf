import { act, renderHook } from "@testing-library/react-native";

import type { FrameClockHandle, FrameRenderedEvent } from "../../../modules/frame-clock/src";
import { useFramePlayer } from "./useFramePlayer";

/**
 * The transport state machine, without a decoder.
 *
 * These are the properties that decide whether the player is frame-exact, and none of them is
 * observable by looking at the screen: which frame a seek asked for, whether a second seek during
 * a drag was queued rather than fired, and whether a landing was scored against the request it
 * belongs to. The on-device pass proves the decoder honours the request; this proves the request
 * was the right one.
 */

function fakeHandle() {
  return {
    play: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    seekToFrame: jest.fn().mockResolvedValue(undefined),
    markOverlayCommitted: jest.fn().mockResolvedValue(undefined),
    setSeekMode: jest.fn().mockResolvedValue(undefined),
    setPlaybackSpeed: jest.fn().mockResolvedValue(undefined),
    getStats: jest.fn(),
    resetStats: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<FrameClockHandle>;
}

function rendered(frame: number): { nativeEvent: FrameRenderedEvent } {
  return { nativeEvent: { frame, presentationTimeUs: 0, releaseTimeNs: 0 } };
}

async function setup(frameCount = 240) {
  const handle = fakeHandle();
  const view = await renderHook(() => useFramePlayer(frameCount));
  await act(async () => {
    view.result.current.ref.current = handle;
  });
  return { handle, view };
}

describe("seeking", () => {
  it("asks for the frame requested, and shows it before it has landed", async () => {
    const { handle, view } = await setup();

    await act(async () => view.result.current.actions.seekTo(120));

    expect(handle.seekToFrame).toHaveBeenCalledWith(120);
    // The transport shows the target immediately. A readout that waited for a decode would lag a
    // finger by however long the seek takes, which is the most visible thing on the screen.
    expect(view.result.current.state.frame).toBe(120);
    expect(view.result.current.state.presented).toBe(0);
  });

  it("clamps a request to the clip", async () => {
    const { handle, view } = await setup(240);

    await act(async () => view.result.current.actions.seekTo(5000));
    expect(handle.seekToFrame).toHaveBeenCalledWith(239);

    await act(async () => view.result.current.actions.seekTo(-20));
    // Queued behind the first, so nothing new is issued until that one lands.
    expect(handle.seekToFrame).toHaveBeenCalledTimes(1);
  });

  it("keeps one seek in flight and issues the newest target when it lands", async () => {
    const { handle, view } = await setup();

    await act(async () => view.result.current.actions.seekTo(100));
    await act(async () => view.result.current.actions.seekTo(140));
    await act(async () => view.result.current.actions.seekTo(180));

    // A drag produces a seek per touch sample. Firing them all queues the decoder and the picture
    // ends up as far behind the finger as the queue is deep.
    expect(handle.seekToFrame).toHaveBeenCalledTimes(1);
    expect(view.result.current.state.frame).toBe(180); // the finger stays authoritative

    await act(async () => view.result.current.handlers.onFrameRendered(rendered(100)));

    expect(handle.seekToFrame).toHaveBeenCalledTimes(2);
    expect(handle.seekToFrame).toHaveBeenLastCalledWith(180);
    // 140 is never issued — it was superseded before the decoder was free.
    expect(handle.seekToFrame).not.toHaveBeenCalledWith(140);
  });

  it("scores a landing against the request it belongs to", async () => {
    const { view } = await setup();

    await act(async () => view.result.current.actions.seekTo(100));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(100)));

    expect(view.result.current.state.seeksIssued).toBe(1);
    expect(view.result.current.state.seeksExact).toBe(1);
    expect(view.result.current.state.worstSeekError).toBe(0);
  });

  it("counts a miss and keeps the worst one", async () => {
    const { view } = await setup();

    await act(async () => view.result.current.actions.seekTo(100));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(101)));
    await act(async () => view.result.current.actions.seekTo(50));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(53)));

    expect(view.result.current.state.seeksIssued).toBe(2);
    expect(view.result.current.state.seeksExact).toBe(0);
    // The max, not the mean: one bad seek is exactly what an average would hide.
    expect(view.result.current.state.worstSeekError).toBe(3);
  });

  it("hands authority back to the picture once nothing is outstanding", async () => {
    const { view } = await setup();

    await act(async () => view.result.current.actions.seekTo(100));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(100)));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(101)));

    expect(view.result.current.state.frame).toBe(101);
  });

  it("pauses, because a seek under playback lands somewhere the decoder has already left", async () => {
    const { handle, view } = await setup();

    await act(async () => view.result.current.actions.play());
    await act(async () => view.result.current.actions.seekTo(100));

    expect(handle.pause).toHaveBeenCalled();
    expect(view.result.current.state.playing).toBe(false);
  });
});

describe("stepping", () => {
  it("steps by one and by ten from the current target", async () => {
    const { handle, view } = await setup();

    await act(async () => view.result.current.actions.seekTo(100));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(100)));
    await act(async () => view.result.current.actions.step(1));

    expect(handle.seekToFrame).toHaveBeenLastCalledWith(101);
  });

  it("accumulates taps that arrive before the previous one has landed", async () => {
    const { handle, view } = await setup();

    // Two taps of "+1" in quick succession must move two frames. Stepping from the PRESENTED frame
    // would make the second tap re-request the first tap's target and the control would feel dead.
    await act(async () => view.result.current.actions.step(1));
    await act(async () => view.result.current.actions.step(1));

    expect(view.result.current.state.frame).toBe(2);
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(1)));
    expect(handle.seekToFrame).toHaveBeenLastCalledWith(2);
  });

  it("stops at both ends rather than wrapping", async () => {
    const { handle, view } = await setup(240);

    await act(async () => view.result.current.actions.seekTo(239));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(239)));
    await act(async () => view.result.current.actions.step(10));
    expect(handle.seekToFrame).toHaveBeenLastCalledWith(239);

    await act(async () => view.result.current.handlers.onFrameRendered(rendered(239)));
    await act(async () => view.result.current.actions.seekTo(0));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(0)));
    await act(async () => view.result.current.actions.step(-1));
    expect(handle.seekToFrame).toHaveBeenLastCalledWith(0);
  });
});

describe("playback", () => {
  it("drops an outstanding seek so it cannot yank the picture back mid-play", async () => {
    const { handle, view } = await setup();

    await act(async () => view.result.current.actions.seekTo(100));
    await act(async () => view.result.current.actions.play());
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(100)));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(101)));

    expect(handle.play).toHaveBeenCalled();
    expect(view.result.current.state.playing).toBe(true);
    expect(view.result.current.state.frame).toBe(101);
    // The abandoned seek is not scored — it was never a measurement of anything.
    expect(view.result.current.state.seeksExact).toBe(0);
  });

  it("toggles", async () => {
    const { handle, view } = await setup();

    await act(async () => view.result.current.actions.toggle());
    expect(view.result.current.state.playing).toBe(true);
    await act(async () => view.result.current.actions.toggle());
    expect(view.result.current.state.playing).toBe(false);
    expect(handle.pause).toHaveBeenCalled();
  });
});

describe("readiness and failure", () => {
  it("keeps the container's own facts, including a frame rate to compare against", async () => {
    const { view } = await setup();

    await act(async () =>
      view.result.current.handlers.onReady({
        nativeEvent: {
          durationMs: 4000,
          width: 1080,
          height: 1920,
          rotationDegrees: 0,
          containerFps: 60,
        },
      }),
    );

    expect(view.result.current.state.ready).toEqual({
      durationMs: 4000,
      width: 1080,
      height: 1920,
      // CODED orientation travels with the dimensions — a caller sizing a box from width/height
      // alone squashes every rotated phone clip, so the pair is never carried without it.
      rotationDegrees: 0,
      containerFps: 60,
    });
  });

  it("surfaces a playback failure and stops claiming to be playing", async () => {
    const { view } = await setup();

    await act(async () => view.result.current.actions.play());
    await act(async () =>
      view.result.current.handlers.onPlayerError({ nativeEvent: { message: "Source error" } }),
    );

    expect(view.result.current.state.error).toBe("Source error");
    expect(view.result.current.state.playing).toBe(false);
  });
});

describe("what the exactness figure is measured over", () => {
  it("divides by landed seeks, not issued ones", async () => {
    const { view } = await setup();

    await act(async () => view.result.current.actions.seekTo(100));
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(100)));
    await act(async () => view.result.current.actions.seekTo(200));

    // One landed exactly, one is still in flight. Dividing by `issued` reports 1/2 = 50% about a
    // run in which nothing has missed — which is exactly what the panel showed mid-sweep.
    expect(view.result.current.state.seeksIssued).toBe(2);
    expect(view.result.current.state.seeksLanded).toBe(1);
    expect(view.result.current.state.seeksExact).toBe(1);
    expect(view.result.current.state.seeking).toBe(true);

    await act(async () => view.result.current.handlers.onFrameRendered(rendered(200)));
    expect(view.result.current.state.seeksLanded).toBe(2);
    expect(view.result.current.state.seeking).toBe(false);
  });
});

/**
 * Looping, which no longer has a button.
 *
 * The loop control was removed from the dock — a swing is about a second and a half, so a player
 * that stops dead at the finish makes a golfer press play for every look at the same two frames,
 * and in a year nobody has wanted it off. That makes this the ONLY place the behaviour is checked:
 * with no control to poke, a regression here would be silent on screen until someone noticed the
 * swing had stopped repeating.
 */
describe("looping", () => {
  it("is on by default", async () => {
    const { view } = await setup();
    expect(view.result.current.state.looping).toBe(true);
  });

  it("restarts at the window start instead of stopping at its end", async () => {
    const { handle, view } = await setup();
    await act(async () => {
      view.result.current.actions.play();
    });
    handle.seekToFrame.mockClear();

    // The last frame of the window arrives during playback, with no seek outstanding.
    await act(async () => view.result.current.handlers.onFrameRendered(rendered(239)));

    // Seeks without pausing: pausing at the finish and playing again on the landing produces a
    // visible hitch on every single loop, at the frame a golfer looks at most.
    expect(handle.seekToFrame).toHaveBeenCalledWith(0);
    expect(handle.pause).not.toHaveBeenCalled();
    expect(view.result.current.state.playing).toBe(true);
  });

  it("stops at the end once looping is off", async () => {
    const { handle, view } = await setup();
    await act(async () => {
      view.result.current.actions.setLooping(false);
      view.result.current.actions.play();
    });
    handle.seekToFrame.mockClear();

    await act(async () => view.result.current.handlers.onFrameRendered(rendered(239)));

    expect(handle.pause).toHaveBeenCalled();
    expect(view.result.current.state.playing).toBe(false);
  });
});
