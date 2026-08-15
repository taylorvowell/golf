import { fireEvent, render } from "@testing-library/react-native";

import type { ReportViewModel } from "./selectors";

jest.mock("../../platform/client", () => ({
  api: {
    mediaSource: async (path: string) => ({ uri: `http://test/${path}`, headers: {} }),
  },
}));

import { ReportSheet } from "./ReportSheet";

/**
 * The sheet is a pure renderer of the view-model; what is pinned is that every mockup slot
 * shows what the selector said — and that an unscored board renders the abstention, never a
 * fabricated profile.
 */

function vm(over: Partial<ReportViewModel> = {}): ReportViewModel {
  return {
    header: { title: "7iron-2", meta: "irons · down the line · 60 fps" },
    indicator: { band: "Solid", coverage: "18 of 22 checks scored" },
    focus: {
      eyebrow: "Biggest opportunity",
      issue: "More bend from the hips.",
      description: "You're standing too upright at address.",
      coachAdvice: "Bend from the hips.",
      tags: ["Address"],
    },
    board: {
      overall: 84,
      headline: "Strong setup. Impact still leaks points.",
      copy: "Details matter now.",
      strongest: { p: "P1", label: "Setup", score: 89 },
      weakest: { p: "P7", label: "Impact", score: 74 },
      tempo: { ratio: "3.0:1", verdict: "in range" },
    },
    split: {
      positive: { title: "Primary positive", body: "Pressure stayed centered." },
      opportunity: { title: "Main opportunity", body: "Chest is closed at impact." },
    },
    chips: ["Balance 88", "Rotation 79"],
    ...over,
  };
}

it("renders every slot the selector filled", async () => {
  const { getByText } = await render(
    <ReportSheet vm={vm()} swingId="s-1" onBack={() => {}} onShowVideo={() => {}} />,
  );
  expect(getByText("7iron-2")).toBeTruthy();
  expect(getByText("irons · down the line · 60 fps")).toBeTruthy();
  expect(getByText("More bend from the hips.")).toBeTruthy();
  expect(getByText("Strong setup. Impact still leaks points.")).toBeTruthy();
  expect(getByText("Setup 89")).toBeTruthy();
  expect(getByText("Impact 74")).toBeTruthy();
  expect(getByText("Balance 88")).toBeTruthy();
});

it("renders the unscored board as an abstention, never a zero", async () => {
  const { getByText, queryByText } = await render(
    <ReportSheet
      vm={vm({
        board: {
          overall: null,
          headline: "Not enough measured to profile this swing.",
          copy: "The clip did not support scoring — no number beats a wrong one.",
          strongest: null,
          weakest: null,
          tempo: null,
        },
        chips: [],
      })}
      swingId="s-1"
      onBack={() => {}}
      onShowVideo={() => {}}
    />,
  );
  expect(getByText("Not scored")).toBeTruthy();
  expect(queryByText("0")).toBeNull();
});

it("wires back and show-video", async () => {
  const onBack = jest.fn();
  const onShowVideo = jest.fn();
  const { getByLabelText } = await render(
    <ReportSheet vm={vm()} swingId="s-1" onBack={onBack} onShowVideo={onShowVideo} />,
  );
  fireEvent.press(getByLabelText("Back"));
  expect(onBack).toHaveBeenCalled();
  fireEvent.press(getByLabelText("Show full video"));
  expect(onShowVideo).toHaveBeenCalled();
});
