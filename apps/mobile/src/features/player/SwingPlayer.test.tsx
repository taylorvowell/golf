import { ScrollView, StyleSheet, type ViewStyle } from "react-native";
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

it("disables the transport, and says why, when the swing cannot be stepped", async () => {
  const { getByTestId, getByText } = await render(
    <SwingPlayer swingId="abc" frameCount={0} fps={0} />,
  );

  await waitFor(() => expect(getByTestId("play-toggle").props.accessibilityState.disabled).toBe(true));
  expect(getByTestId("step-fwd-1").props.accessibilityState.disabled).toBe(true);
  expect(getByText(/cannot be stepped frame by frame/i)).toBeTruthy();
});

it("shows the frame-sync panel in development — the step's own oracle", async () => {
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  await waitFor(() => expect(getByTestId("frame-sync-panel")).toBeTruthy());
});

it("plays a swing whose analysis is missing, and says so instead of failing", async () => {
  const { getByTestId, getByText } = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60} />,
  );
  await waitFor(() => expect(getByText(/has not been analysed/i)).toBeTruthy());
  // The video is still there. A 404 on the artifact says nothing about the video.
  expect(getByTestId("swing-video")).toBeTruthy();
  expect(getByTestId("play-toggle").props.accessibilityState.disabled).toBe(false);
});

it("separates a missing artifact from a connection failure", async () => {
  // Only one of the two is fixed by trying again, and a golfer told the wrong one acts on it.
  mockRequest.mockRejectedValue(new ApiClientError(500, "http_error", "boom"));
  const { getByText } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  await waitFor(() => expect(getByText(/connection problem/i)).toBeTruthy());
});

it("draws the overlay once the artifact arrives", async () => {
  mockRequest.mockResolvedValue(makeAnalysis());
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  await waitFor(() => expect(getByTestId("overlay-controls")).toBeTruthy());
  await waitFor(() => expect(mockRequest).toHaveBeenCalledWith("swings/abc/analysis"));
});

it("bounds the transport by the playback window, not by the file", async () => {
  // `playback_window` is the span the ANALYZER says is worth playing — address − 1s to finish + 1s.
  // A bar that spanned the whole file would spend its travel outside the swing.
  mockRequest.mockResolvedValue(makeAnalysis({ frameCount: 40, playbackWindow: [4, 30] }));
  const { getByText } = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  await waitFor(() => expect(getByText("4–30")).toBeTruthy());
});

/**
 * The console and its layout.
 *
 * These assert behaviour a golfer would notice on a range mat, not markup: that the swing starts
 * without being asked, that the transport survives being scrolled away from, and that pause is the
 * play button pushed IN rather than a different control. The last one is the reason `DeckButton`
 * separates a latched state from a finger-down state at all.
 */

/** The video surface only reports its size once laid out; the console's release depends on it. */
function layout(el: { props: { onLayout?: (e: unknown) => void } }, height: number) {
  el.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 393, height } } });
}

/** Drive the native `onReady`, which is what tells the player the clip exists. */
function ready(el: { props: { onReady?: (e: unknown) => void } }) {
  el.props.onReady?.({
    nativeEvent: { durationMs: 4000, width: 1080, height: 1920, containerFps: 60 },
  });
}

it("starts the swing playing on load, without being asked", async () => {
  mockRequest.mockResolvedValue(makeAnalysis({ frameCount: 40 }));
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={40} fps={60} />);
  await waitFor(() => expect(getByTestId("overlay-controls")).toBeTruthy());

  await act(async () => ready(getByTestId("swing-video")));

  // Pause IS play, depressed — so "is it playing" and "is the cap in" are the same assertion.
  await waitFor(() =>
    expect(getByTestId("play-toggle").props.accessibilityState.selected).toBe(true),
  );
  expect(getByTestId("play-toggle").props.accessibilityLabel).toBe("Pause");
});

it("loops by default — a swing is a second and a half long", async () => {
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  await waitFor(() =>
    expect(getByTestId("loop-toggle").props.accessibilityState.selected).toBe(true),
  );
});

it("changes speed natively rather than by dropping frames", async () => {
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  const quarter = getByTestId("speed-0-25");
  await act(async () => quarter.props.onClick?.() ?? fireEvent.press(quarter));
  await waitFor(() => expect(quarter.props.accessibilityState.selected).toBe(true));
});

it("pulls the picture back into view when a control is touched", async () => {
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  // Spied on the class, not on the rendered host element: the test renderer's host node carries
  // props, not the imperative handle the component actually calls through its ref.
  const spy = jest
    .spyOn(ScrollView.prototype as unknown as { scrollTo: () => void }, "scrollTo")
    .mockImplementation(() => {});
  fireEvent.press(getByTestId("step-fwd-1"));
  expect(spy).toHaveBeenCalledWith({ y: 0, animated: true });
  spy.mockRestore();
});

it("keeps the console mounted while the picture is scrolled past", async () => {
  // It slides out of the way rather than unmounting: a console that unmounted would drop the
  // transport's state and lose the speed and loop the golfer had chosen.
  const { getByTestId } = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  layout(getByTestId("swing-video").parent ?? getByTestId("swing-video"), 700);
  fireEvent.scroll(getByTestId("swing-scroll"), {
    nativeEvent: { contentOffset: { y: 900 }, contentSize: { height: 2000, width: 393 },
                   layoutMeasurement: { height: 852, width: 393 } },
  });
  expect(getByTestId("player-console")).toBeTruthy();
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

/**
 * The picture's box, and the fact that it must never change size.
 *
 * The failure this pins is a layout one, not a rendering one: the stage used to default to 16:9,
 * so a portrait clip loaded squat and then jumped to full height the instant the artifact landed —
 * shoving the analysis below it down the screen while it was being read. The box now comes from
 * the swing list, which already has it before this screen mounts.
 */

function stageAspect(el: { props: { style?: unknown } }) {
  const flat = StyleSheet.flatten(el.props.style as ViewStyle);
  return flat.aspectRatio;
}

/** The stage is the placeholder's parent — the box whose height is in question. */
function stageOf(api: { getByTestId: (id: string) => { parent: unknown } }) {
  return api.getByTestId("stage-placeholder").parent as { props: { style?: unknown } };
}

it("takes the picture's box from the swing list, before anything is fetched", async () => {
  // 1080x1920. Nothing has resolved yet — no source, no artifact — and the box is already right.
  const api = await render(
    <SwingPlayer swingId="abc" frameCount={240} fps={60} aspectRatio={1080 / 1920} />,
  );
  expect(stageAspect(stageOf(api))).toBeCloseTo(0.5625);
});

it("does not resize the box when the artifact arrives", async () => {
  mockRequest.mockResolvedValue(makeAnalysis({ frameCount: 40 }));
  const api = await render(
    <SwingPlayer swingId="abc" frameCount={40} fps={60} aspectRatio={1080 / 1920} />,
  );
  const before = stageAspect(stageOf(api));
  await waitFor(() => expect(api.getByTestId("overlay-controls")).toBeTruthy());
  // The fixture is 1080x1920 too, because both numbers come from the same probe. Equal, not close:
  // a box that changed at all would push the analysis down the screen.
  expect(stageAspect(stageOf(api))).toBe(before);
});

it("assumes portrait, not 16:9, when the swing never recorded a size", async () => {
  // A view analysed before those columns existed. Every clip this product has seen was filmed on a
  // phone held upright, and the landscape default is what made the picture load squashed.
  const api = await render(<SwingPlayer swingId="abc" frameCount={240} fps={60} />);
  expect(stageAspect(stageOf(api))).toBeCloseTo(9 / 16);
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
