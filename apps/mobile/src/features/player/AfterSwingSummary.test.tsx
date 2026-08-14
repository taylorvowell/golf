import { render, waitFor } from "@testing-library/react-native";

import { AfterSwingSummary } from "./AfterSwingSummary";

/**
 * The summary is the sample's design over REAL fields, and what is pinned is the honesty rules
 * that make that safe: the list's score draws before the report lands, a swing with no scorecard
 * says so instead of showing a zero, and the trend/delta appear only when the log actually holds
 * prior scored swings.
 */

it("draws the list's score and band while the report is still loading", async () => {
  const { getByText, getAllByText } = await render(
    <AfterSwingSummary state={{ kind: "loading" }} score={77} band="Pure" history={[70, 77]} />,
  );
  // The gauge's number counts up over ~900ms — wait for the sweep to land on the score.
  await waitFor(() => expect(getByText("77")).toBeTruthy(), { timeout: 3000 });
  // Twice: the band chip and the gauge scale's right label both say Pure by design.
  expect(getAllByText("Pure").length).toBeGreaterThanOrEqual(1);
  expect(getByText("OUT OF 100")).toBeTruthy();
});

it("says not-scored instead of showing a zero", async () => {
  const { getByText, queryByText } = await render(
    <AfterSwingSummary state={{ kind: "not-scored" }} score={null} />,
  );
  expect(getByText(/has not been scored/)).toBeTruthy();
  expect(queryByText("0")).toBeNull();
  expect(queryByText("OUT OF 100")).toBeNull();
});

it("shows the trend delta only when there are prior scored swings", async () => {
  const alone = await render(
    <AfterSwingSummary state={{ kind: "loading" }} score={62} history={[62]} />,
  );
  expect(alone.queryByText(/Last \d+ swings/)).toBeNull();
  alone.unmount();

  const several = await render(
    <AfterSwingSummary state={{ kind: "loading" }} score={82} history={[74, 71, 78, 80, 82]} />,
  );
  expect(await several.findByText("+8")).toBeTruthy();
  expect(await several.findByText(/Last 5 swings/i)).toBeTruthy();
});
