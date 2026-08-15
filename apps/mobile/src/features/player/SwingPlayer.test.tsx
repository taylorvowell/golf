import { Alert, StyleSheet, Text, type ViewStyle } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { SwingPlayer } from "./SwingPlayer";
import { ApiClientError } from "../../platform/api";
import { makeAnalysis } from "./overlay/__fixtures__/analysis";

/**
 * The invariants that are not about arithmetic.
 *
 * The load-bearing one is authorization: `/video` is behind auth, and an unauthenticated request
 * is *answered* as the development fallback identity, so it returns **404 rather than 401** and
 * the video reads as a swing that does not exist (D48, D50). Nothing on screen would say so. The
 * assertion that the source carries its `Authorization` header is therefore the same assertion
 * `SwingCard.test.tsx` makes about thumbnails, for the same reason.
 *
 * The second is the refusal to draw a transport that lies: a swing with no frame count cannot be
 * stepped, and buttons that move nothing are worse than a plain video because a golfer cannot tell
 * a broken control from a still swing.
 *
 * The third arrived with the overlay: **a swing with no artifact still plays.** A 404 from
 * `/analysis` is a real and permanent state — a swing that failed analysis — not an error, and a
 * player that refused to show the video would be reporting a fault the golfer does not have.
 */

const mockMediaSource = jest.fn();
const mockRequest = jest.fn();

jest.mock("../../platform/client", () => ({
  api: {
    mediaSource: (path: string) => mockMediaSource(path),
    request: (path: string) => mockRequest(path),
  },
}));

beforeEach(() => {
  mockMediaSource.mockReset();
  mockRequest.mockReset();
  mockMediaSource.mockResolvedValue({
    uri: "http://api.test.invalid/api/v1/swings/abc/video",
    headers: { Authorization: "Bearer test-token" },
  });
  // Default: not analysed. Every step-01 assertion below is about the video and the transport, and
  // they must hold on a swing with no overlay at all.
  mockRequest.mockRejectedValue(new ApiClientError(404, "http_error", "not found"));
});

/**
 * Resolve the ARTIFACT and nothing else — the report and corrections stay honest 404s, exactly
 * a swing analysed without scoring. A blanket `mockResolvedValue` would also answer `/report`,
 * handing the summary an Analysis cast as a CoachReport — a shape no server produces.
 */
function analysisResolves(analysis: ReturnType<typeof makeAnalysis>) {
  mockRequest.mockImplementation((path: string) =>
    path.includes("/analysis")
      ? Promise.resolve(analysis)
      : Promise.reject(new ApiClientError(404, "http_error", "not found")),
  );
}

it("gives the video surface a source carrying the session", async () => {
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);

  await waitFor(() => expect(mockMediaSource).toHaveBeenCalledWith("swings/abc/video"));

  await waitFor(() => {
    const video = getByTestId("swing-video");
    expect(video.props.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(video.props.source).toContain("/api/v1/swings/abc/video");
  });
});

it("asks for an angle by view TYPE, never by view id", async () => {
  // `SwingSummary` carries `primaryViewId` (a uuid) and `views[].view` (`dtl` | `face_on`), and
  // passing the first one here is what made every swing answer **400 "unknown view"** — the route
  // refuses an unrecognised view rather than quietly serving the default.
  await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} view="face_on" />);
  await waitFor(() =>
    expect(mockMediaSource).toHaveBeenCalledWith("swings/abc/video?view=face_on"),
  );
});

it("asks for no angle at all when none is named, so the route serves the primary", async () => {
  await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  await waitFor(() => expect(mockMediaSource).toHaveBeenCalledWith("swings/abc/video"));
});

it("passes the analysed frame rate through, never a default", async () => {
  // §2.3: if the source is 30fps, report 30. A player that quietly assumed 60 would put every
  // frame index out by a factor of two while every number on screen still looked plausible.
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={120} fps={30} />);
  await waitFor(() => expect(getByTestId("swing-video").props.fps).toBe(30));
});

/**
 * The transport lives ABOVE the summary card and only while the card is down — its surface is
 * covered when the card is up, exactly like the overlay chips. Tests that poke the console
 * slide the card away first, the same move a golfer makes.
 */
async function cardDown(api: { getByTestId: (id: string) => unknown }) {
  await act(
    async () =>
      void fireEvent.press(api.getByTestId("summary-cover-handle") as Parameters<typeof fireEvent.press>[0]),
  );
}

it("disables the transport, and says why, when the swing cannot be stepped", async () => {
  const api = await render(<SwingPlayer swingId="abc" frameCount={0} fps={0} />);
  const { getByTestId, getByText } = api;
  await cardDown(api);

  await waitFor(() => expect(getByTestId("play-toggle").props.accessibilityState.disabled).toBe(true));
  expect(getByTestId("speed-0-1").props.accessibilityState.disabled).toBe(true);
  expect(getByText(/cannot be stepped frame by frame/i)).toBeTruthy();
});

it("shows the frame-sync panel in development — the step's own oracle", async () => {
  // Inside the Metrics panel now, and development only: the picture fills the screen, and the
  // instrument must not. It measures against a video that keeps playing behind the panel.
  const api = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  await cardDown(api);
  await act(async () => void fireEvent.press(api.getByTestId("metrics-open")));
  await waitFor(() => expect(api.getByTestId("frame-sync-panel")).toBeTruthy());
});

it("plays a swing whose analysis is missing, and says so instead of failing", async () => {
  const api = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  const { getByTestId, getByText } = api;
  await waitFor(() => expect(getByText(/has not been analysed/i)).toBeTruthy());
  // The video is still there. A 404 on the artifact says nothing about the video.
  expect(getByTestId("swing-video")).toBeTruthy();
  await cardDown(api);
  expect(getByTestId("play-toggle").props.accessibilityState.disabled).toBe(false);
});

it("separates a missing artifact from a connection failure", async () => {
  // Only one of the two is fixed by trying again, and a golfer told the wrong one acts on it.
  // `getAll`: the notice over the picture AND the summary on the page both say it, on purpose.
  mockRequest.mockRejectedValue(new ApiClientError(500, "http_error", "boom"));
  const { getAllByText } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  await waitFor(() => expect(getAllByText(/connection problem/i).length).toBeGreaterThan(0));
});

it("draws the overlay once the artifact arrives", async () => {
  analysisResolves(makeAnalysis());
  const api = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  // The overlay draws into a measured box, so the viewport has to have been laid out — it renders
  // nothing at all at zero size rather than drawing a skeleton at the origin.
  await act(async () => viewport(api));
  // The drawing itself, over the picture — not the switches, which now live behind a panel.
  await waitFor(() => expect(api.getByTestId("swing-overlay")).toBeTruthy());
  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith("swings/abc/analysis"));
});

it("bounds the transport by the playback window, not by the file", async () => {
  // `playback_window` is the span the ANALYZER says is worth playing — address − 1s to finish + 1s.
  // A bar that spanned the whole file would spend its travel outside the swing.
  analysisResolves(makeAnalysis({ frameCount: 40, playbackWindow: [4, 30] }));
  const api = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  await act(async () => viewport(api));
  await waitFor(() => expect(api.getByTestId("swing-overlay")).toBeTruthy());
  await cardDown(api);
  await act(async () => void fireEvent.press(api.getByTestId("metrics-open")));
  await waitFor(() => expect(api.getByText("4–30")).toBeTruthy());
});

/**
 * The console and its layout.
 *
 * These assert behaviour a golfer would notice on a range mat, not markup: that the swing waits
 * parked under the arrival card and plays the moment the card is dismissed, that the controls
 * can be taken off the picture they are covering, and that pause is the play button pushed IN
 * rather than a different control. The last one is the reason `DeckButton` separates a latched
 * state from a finger-down state at all.
 */

/** Drive the native `onReady`, which is what tells the player the clip exists. */
function ready(el: { props: { onReady?: (e: unknown) => void } }) {
  el.props.onReady?.({
    nativeEvent: { durationMs: 4000, width: 1080, height: 1920, containerFps: 60 },
  });
}

it("parks under the card, then plays the moment the card slides away", async () => {
  analysisResolves(makeAnalysis({ frameCount: 40 }));
  const api = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  const { getByTestId, queryByTestId } = api;
  await act(async () => viewport(api));
  await waitFor(() => expect(getByTestId("swing-overlay")).toBeTruthy());

  await act(async () => ready(getByTestId("swing-video")));

  // Under the card: the picture waits rather than playing to no one, and the transport — whose
  // surface the card covers — is not on the glass at all.
  expect(queryByTestId("play-toggle")).toBeNull();

  await cardDown(api);

  // Pause IS play, depressed — so "is it playing" and "is the cap in" are the same assertion.
  await waitFor(() =>
    expect(getByTestId("play-toggle").props.accessibilityState.selected).toBe(true),
  );
  expect(getByTestId("play-toggle").props.accessibilityLabel).toBe("Pause");
});

it("changes speed natively rather than by dropping frames", async () => {
  // `setPlaybackSpeed` retimes the decoder, so a 60fps clip at 0.1 is a true 6 frames a second
  // with every frame still presented — where dropping frames in JS would show a tenth of the
  // swing and call it slow motion.
  const api = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  const { getByTestId } = api;
  await cardDown(api);
  await act(async () => void fireEvent.press(getByTestId("speed-0-1")));
  await waitFor(() =>
    expect(getByTestId("speed-0-1").props.accessibilityState.selected).toBe(true),
  );
  expect(getByTestId("speed-1").props.accessibilityState.selected).toBe(false);
});

it("draws the back control and the swing's name over the picture", async () => {
  const onBack = jest.fn();
  const { getByTestId, getByText } = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60} title="6iron3" onBack={onBack} />,
  );
  expect(getByText("6iron3")).toBeTruthy();
  fireEvent.press(getByTestId("player-back"));
  expect(onBack).toHaveBeenCalled();
});

it("says where in the swing you are by NAME, not with a picture", async () => {
  // The readout is the whole answer to "where am I", and it costs one line of text. A strip of
  // thumbnails cost an artifact, a request, a decode and forty points of screen to say the same
  // thing less precisely, which is why it is gone.
  analysisResolves(makeAnalysis({ frameCount: 40, playbackWindow: [4, 30] }));
  const api = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  await act(async () => viewport(api));
  await waitFor(() => expect(api.getByTestId("swing-overlay")).toBeTruthy());
  await cardDown(api);

  // Frame 10 of this fixture is inside the backswing (address 2 -> clamped to the window at 4,
  // top at 12). The readout names the phase and the frame, and nothing else.
  await act(async () =>
    api.getByTestId("swing-video").props.onFrameRendered?.({
      nativeEvent: { frame: 10, presentationTimeUs: 0, releaseTimeNs: 0 },
    }),
  );
  await waitFor(() => expect(api.getByText("Backswing")).toBeTruthy());
  expect(api.getByText("10")).toBeTruthy();
});

it("puts no score chip over the picture, scored or not", async () => {
  // Removed outright (Taylor, 2026-08-13): the score lives in the summary and the scorecard,
  // and a chip over the video repeated both.
  const scored = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} score={82} />);
  expect(scored.queryByTestId("score-chip")).toBeNull();
});

/**
 * The panels.
 *
 * The picture fills the screen, so there is no *below* for the swing's numbers or the overlay
 * switches to live in. They come up over it. What these pin is that the panel is genuinely closed
 * until asked for — a sheet mounted-but-hidden would keep its content in the accessibility tree
 * and hand a screen-reader user controls they cannot see.
 */

it("keeps the overlay switches in a panel until they are asked for", async () => {
  analysisResolves(makeAnalysis({ frameCount: 40 }));
  const api = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  const { getByTestId, queryByTestId, findByTestId } = api;
  await act(async () => viewport(api));
  await waitFor(() => expect(getByTestId("swing-overlay")).toBeTruthy());
  // The chips act on a video the card is covering, so they only exist once it is down.
  expect(queryByTestId("overlays-open")).toBeNull();
  await act(async () => void fireEvent.press(getByTestId("summary-cover-handle")));
  expect(queryByTestId("overlay-controls")).toBeNull();

  await act(async () => void fireEvent.press(await findByTestId("overlays-open")));
  await waitFor(() => expect(getByTestId("overlay-controls")).toBeTruthy());
});

it("never hides the controls while the video is the subject — no tap-to-hide, no hover", async () => {
  // Reversed from the original toggle deliberately (Taylor, 2026-08-13): this is a phone, and a
  // control that can vanish is a control a golfer has to know how to summon. With the card down
  // the transport is always on the picture and always receives touches; the card covering it is
  // the one sanctioned way it leaves.
  const api = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60} />,
  );
  await cardDown(api);
  expect(api.queryByTestId("stage-tap")).toBeNull();
  expect(api.getByTestId("console-dock").props.pointerEvents ?? "auto").not.toBe("none");
});

it("opens the swing's facts from the dock", async () => {
  const api = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60}>
      <Text>Pose coverage 98%</Text>
    </SwingPlayer>,
  );
  const { getByTestId, getByText, queryByText } = api;
  expect(queryByText("Pose coverage 98%")).toBeNull();

  await cardDown(api);
  await act(async () => void fireEvent.press(getByTestId("metrics-open")));
  await waitFor(() => expect(getByText("Pose coverage 98%")).toBeTruthy());
});

/**
 * The picture's box, and the fact that it must never change size.
 *
 * The failure this pins is a layout one, not a rendering one: the stage used to default to 16:9,
 * so a portrait clip loaded squat and then jumped to full height the instant the artifact landed.
 * The box now comes from the swing list, which already has it before this screen mounts.
 *
 * It is fitted in JS rather than by Yoga's `aspectRatio`, so these read a real width and height.
 * That is the point of the change: with both axes pinned Yoga drops the aspect silently, and the
 * overlay's normalized coordinates cannot survive a box that is not the artifact's shape.
 */

/** The viewport only has a size once laid out, and the fitted box is derived from it. */
function viewport(
  api: { getByTestId: (id: string) => { props: { onLayout?: (e: unknown) => void } } },
  width = 393,
  height = 852,
) {
  api
    .getByTestId("swing-player")
    .props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
}

function stageBox(api: { getByTestId: (id: string) => { props: { style?: unknown } } }) {
  const flat = StyleSheet.flatten(api.getByTestId("swing-stage").props.style as ViewStyle);
  return { w: Number(flat.width), h: Number(flat.height) };
}

it("takes the picture's box from the swing list, before anything is fetched", async () => {
  // 1080x1920. Nothing has resolved yet — no source, no artifact — and the box is already right.
  const api = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60} aspectRatio={1080 / 1920} />,
  );
  await act(async () => viewport(api));
  const box = stageBox(api);
  expect(box.w / box.h).toBeCloseTo(0.5625);
  expect(box.w).toBe(393);
});

it("does not resize the box when the artifact arrives", async () => {
  analysisResolves(makeAnalysis({ frameCount: 40 }));
  const api = await render(
    <SwingPlayer swingId="abc" frameCount={40} fps={60} aspectRatio={1080 / 1920} />,
  );
  await act(async () => viewport(api));
  const before = stageBox(api);
  await waitFor(() => expect(api.getByTestId("swing-overlay")).toBeTruthy());
  // The fixture is 1080x1920 too, because both numbers come from the same probe. Equal, not close:
  // a box that changed at all would move the picture under the golfer mid-swing.
  expect(stageBox(api)).toEqual(before);
});

it("assumes portrait, not 16:9, when the swing never recorded a size", async () => {
  // A view analysed before those columns existed. Every clip this product has seen was filmed on a
  // phone held upright, and the landscape default is what made the picture load squashed.
  const api = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  await act(async () => viewport(api));
  const box = stageBox(api);
  expect(box.w / box.h).toBeCloseTo(9 / 16);
});

it("holds the aspect by shrinking the width when the clip is taller than the screen", async () => {
  // The case Yoga gets silently wrong. A 1080x2700 clip on a short viewport cannot be full width,
  // and a box that stayed full width would stretch the picture — putting the drawn skeleton beside
  // the golfer rather than on them, which reads as a pose failure rather than a layout one.
  const api = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60} aspectRatio={0.4} />,
  );
  await act(async () => viewport(api, 400, 800));
  const box = stageBox(api);
  // The stage fits above the card's closed peek, so the height is bounded by that, not 800.
  expect(box.h).toBeLessThan(800);
  expect(box.h).toBeGreaterThan(600);
  expect(box.w / box.h).toBeCloseTo(0.4);
});

it("holds a placeholder over the box until a frame has reached the glass", async () => {
  const { getByTestId } = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60} aspectRatio={0.5625} />,
  );
  expect(getByTestId("stage-placeholder")).toBeTruthy();

  await act(async () =>
    getByTestId("swing-video").props.onFrameRendered?.({
      nativeEvent: { frame: 0, presentationTimeUs: 0, releaseTimeNs: 0 },
    }),
  );

  // Frame ZERO. The placeholder has to go on "a frame arrived", never on the frame number — 0 is
  // the frame every clip starts on.
  await waitFor(() => expect(getByTestId("stage-placeholder").props.style).toBeTruthy());
});

/**
 * Session mode — the same player in its just-recorded shape. What is pinned: the card and the
 * dock exist, the picture does not autoplay underneath the open card, and delete is a two-step
 * in which only the confirmation deletes.
 */
describe("session mode", () => {
  it("shows the card and the dock over the mounted picture", async () => {
    const { getByTestId } = await render(
      <SwingPlayer swingId="abc" frameCount={240} fps={60} mode="session" />,
    );
    await waitFor(() => {
      expect(getByTestId("summary-cover")).toBeTruthy();
      expect(getByTestId("after-swing-dock")).toBeTruthy();
      // The main surface stays mounted — it is the thing a slide down reveals.
      expect(getByTestId("swing-video")).toBeTruthy();
    });
  });

  it("folds the dock to its tab when the card slides away — and the card stays reachable", async () => {
    const { getByTestId, queryByTestId, findByLabelText } = await render(
      <SwingPlayer swingId="abc" frameCount={240} fps={60} mode="session" />,
    );
    await waitFor(() => expect(getByTestId("summary-cover")).toBeTruthy());

    // Slide the card away through its accessible grip.
    await act(async () => void fireEvent.press(getByTestId("summary-cover-handle")));

    // The card is parked at its peek, never unmounted — the same grip brings it back — and the
    // dock has folded to its tab (whose label now speaks about the menu, not the summary).
    expect(getByTestId("summary-cover")).toBeTruthy();
    expect(await findByLabelText("Show summary")).toBeTruthy();
    expect(await findByLabelText("Show menu")).toBeTruthy();
    expect(queryByTestId("after-swing-dock-record")).toBeNull();
  });

  it("deletes only through the confirmation", async () => {
    const onDelete = jest.fn();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByTestId } = await render(
      <SwingPlayer swingId="abc" frameCount={240} fps={60} mode="session" onDelete={onDelete} />,
    );

    await act(async () => void fireEvent.press(getByTestId("after-swing-dock-delete")));
    // The press asked; nothing may have happened yet.
    expect(onDelete).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    const destructive = buttons.find((b) => b.style === "destructive");
    expect(destructive).toBeTruthy();
    await act(async () => destructive?.onPress?.());
    expect(onDelete).toHaveBeenCalledTimes(1);

    alertSpy.mockRestore();
  });
});

/**
 * Review mode — the default, what the log opens. The same card over the same fixed video —
 * an old swing's scorecard is the same product as a new swing's. What is pinned is the split
 * itself: the card behaves the same, and none of the just-recorded chrome comes with it.
 */
describe("review mode", () => {
  it("opens with the summary card up over the picture — no preference to wait for", async () => {
    const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
    await waitFor(() => {
      expect(getByTestId("summary-cover")).toBeTruthy();
      expect(getByTestId("after-swing-summary")).toBeTruthy();
      expect(getByTestId("swing-video")).toBeTruthy();
    });
  });

  it("carries no dock and no opener toggle, card up or down", async () => {
    const { getByTestId, queryByTestId } = await render(
      <SwingPlayer swingId="abc" frameCount={240} fps={60} />,
    );
    await waitFor(() => expect(getByTestId("summary-cover")).toBeTruthy());
    expect(queryByTestId("after-swing-dock")).toBeNull();
    expect(queryByTestId("opener-toggle")).toBeNull();

    // Card down: the video is the subject, the card waits at its peek, still no session chrome.
    await act(async () => void fireEvent.press(getByTestId("summary-cover-handle")));
    expect(getByTestId("after-swing-summary")).toBeTruthy();
    expect(queryByTestId("after-swing-dock")).toBeNull();
    expect(queryByTestId("opener-toggle")).toBeNull();
  });
});
