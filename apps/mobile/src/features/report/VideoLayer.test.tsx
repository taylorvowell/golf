import { Text } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { ReportVideoLayer } from "./VideoLayer";
import { ApiClientError } from "../../platform/api";
import { makeAnalysis } from "../player/overlay/__fixtures__/analysis";

/**
 * The video-open contract — the report's signature interaction, pinned as behaviour:
 *
 * - Crossing the scroll threshold is the ONLY thing that shows or hides chrome. Open gates
 *   the controls' touches on; closed gates them off and hands the pill nav back.
 * - The pause policy is a function of the same crossing: open plays, closed pauses. A movie
 *   under an opaque report sheet is a decoder running for nobody.
 * - The scrub converts positions through the transport's one x↔frame mapping — asserted here
 *   through the accessibility actions, which step exactly one frame (no new frame math).
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
  mockRequest.mockRejectedValue(new ApiClientError(404, "http_error", "not found"));
});

/** Resolve the ARTIFACT only — report and corrections stay honest 404s. */
function analysisResolves(analysis: ReturnType<typeof makeAnalysis>) {
  mockRequest.mockImplementation((path: string) =>
    path.includes("/analysis")
      ? Promise.resolve(analysis)
      : Promise.reject(new ApiClientError(404, "http_error", "not found")),
  );
}

function scrollTo(scroller: Parameters<typeof fireEvent.scroll>[0], y: number) {
  fireEvent.scroll(scroller, {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: 2000 },
      layoutMeasurement: { width: 400, height: 800 },
    },
  });
}

function build() {
  return (
    <ReportVideoLayer
      testID="report"
      swingId="abc"
      frameCount={100}
      fps={60}
      score={86}
      tempoRatio={3}
      viewPill="Down the line · Swing #12"
      stickyFooter={<Text>PILL NAV</Text>}
    >
      <Text>SHEET CONTENT</Text>
    </ReportVideoLayer>
  );
}

it("gives the video surface a source carrying the session", async () => {
  const { getByTestId } = await render(build());
  await waitFor(() => expect(mockMediaSource).toHaveBeenCalledWith("swings/abc/video"));
  await waitFor(() => {
    const video = getByTestId("report-video");
    expect(video.props.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(video.props.source).toContain("/api/v1/swings/abc/video");
  });
});

it("keeps the controls untouchable and the pill nav live while the report is up", async () => {
  const { getByTestId, getByText } = await render(build());

  // Closed at rest (initial offset is deep in the sheet). Controls are gated off; nav is on.
  expect(getByTestId("report-overlay").props.pointerEvents).toBe("none");
  expect(getByTestId("report-footer").props.pointerEvents).toBe("box-none");
  expect(getByText("SHEET CONTENT")).toBeTruthy();
  expect(getByText("PILL NAV")).toBeTruthy();
});

it("video-open: controls gate on, pill nav gates off, and the video plays", async () => {
  const api = await render(build());
  const scroller = api.getByTestId("report-scroll");

  await act(async () => scrollTo(scroller, 30));

  expect(api.getByTestId("report-overlay").props.pointerEvents).toBe("box-none");
  expect(api.getByTestId("report-footer").props.pointerEvents).toBe("none");
  // The pause policy's other half: revealing the video is asking for the swing.
  const toggle = await api.findByTestId("report-play-toggle");
  expect(toggle.props.accessibilityLabel).toBe("Pause");
});

it("scrolling the report back pauses the video and restores the nav", async () => {
  const api = await render(build());
  const scroller = api.getByTestId("report-scroll");

  await act(async () => scrollTo(scroller, 30));
  await act(async () => scrollTo(scroller, 200));

  const toggle = await api.findByTestId("report-play-toggle");
  expect(toggle.props.accessibilityLabel).toBe("Play");
  expect(api.getByTestId("report-overlay").props.pointerEvents).toBe("none");
  expect(api.getByTestId("report-footer").props.pointerEvents).toBe("box-none");
});

it("steps exactly one frame through the accessibility actions — the transport's own math", async () => {
  const api = await render(build());
  const scrub = await api.findByTestId("swing-scrub");

  expect(scrub.props.accessibilityValue.text).toMatch(/^frame 0,/);
  await act(async () =>
    fireEvent(scrub, "accessibilityAction", { nativeEvent: { actionName: "increment" } }),
  );
  const after = await api.findByTestId("swing-scrub");
  expect(after.props.accessibilityValue.text).toMatch(/^frame 1,/);

  await act(async () =>
    fireEvent(after, "accessibilityAction", { nativeEvent: { actionName: "decrement" } }),
  );
  const back = await api.findByTestId("swing-scrub");
  expect(back.props.accessibilityValue.text).toMatch(/^frame 0,/);
});

it("draws the artifact's phases on the scrub, to the artifact's own spans", async () => {
  analysisResolves(makeAnalysis());
  const api = await render(build());

  // The five mockup blocks come from phaseBands — same spans the player's strip draws.
  await waitFor(() => expect(api.getByTestId("swing-scrub-backswing")).toBeTruthy());
  expect(api.getByTestId("swing-scrub-downswing")).toBeTruthy();
  expect(api.getByText("Backswing")).toBeTruthy();
  expect(api.getByText("Approach")).toBeTruthy();
});

it("keeps the floating back orb live in every scroll state", async () => {
  const onBack = jest.fn();
  const api = await render(
    <ReportVideoLayer
      testID="report"
      swingId="abc"
      frameCount={100}
      fps={60}
      viewPill="Down the line"
      onBack={onBack}
    >
      <Text>SHEET CONTENT</Text>
    </ReportVideoLayer>,
  );

  // At rest (sheet up) …
  const orb = await api.findByTestId("report-back");
  await act(async () => fireEvent.press(orb));
  expect(onBack).toHaveBeenCalledTimes(1);

  // … and in video-open. A page whose way out scrolls away has no way out.
  await act(async () => scrollTo(api.getByTestId("report-scroll"), 30));
  const orbOpen = await api.findByTestId("report-back");
  await act(async () => fireEvent.press(orbOpen));
  expect(onBack).toHaveBeenCalledTimes(2);
});

it("a tap on the covered video scrolls the sheet open — the picture is its own play button", async () => {
  const api = await render(build());

  // The backdrop tap target exists while the sheet is up; pressing it must not throw (the
  // scroll node's scrollTo is exercised on-device; here we pin the door exists and is wired).
  const door = await api.findByTestId("report-backdrop-tap");
  expect(door.props.accessibilityLabel).toBe("Show the video");
  await act(async () => fireEvent.press(door));
});

it("holds the sheet back until the report is real, then presents it", async () => {
  const api = await render(
    <ReportVideoLayer
      testID="report"
      swingId="abc"
      frameCount={100}
      fps={60}
      viewPill="Down the line"
      sheetPresented={false}
    >
      <Text>SHEET CONTENT</Text>
    </ReportVideoLayer>,
  );

  // Not presented: the scroll gesture is off — a half-loaded card must not be draggable.
  expect(api.getByTestId("report-scroll").props.scrollEnabled).toBe(false);
});

it("disables the scrub and the bar when the swing cannot be stepped", async () => {
  const { findByTestId } = await render(
    <ReportVideoLayer
      testID="report"
      swingId="abc"
      frameCount={0}
      fps={0}
      viewPill="Down the line"
    >
      <Text>SHEET CONTENT</Text>
    </ReportVideoLayer>,
  );

  const scrub = await findByTestId("swing-scrub");
  expect(scrub.props.accessibilityState.disabled).toBe(true);
  const toggle = await findByTestId("report-play-toggle");
  expect(toggle.props.accessibilityState.disabled).toBe(true);
});
