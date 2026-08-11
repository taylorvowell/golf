import { fireEvent, render } from "@testing-library/react-native";

import { ProbeCard } from "./ProbeCard";
import { PROBES, type Probe } from "./probes";

/**
 * The component-rendering half of the mobile test harness.
 *
 * This previously did not work at all: `render()` appeared to return "an object with no query
 * functions", across two dependency-pinning attempts, and the RUNBOOK recorded component testing
 * as unavailable. That object was a **Promise**. `@testing-library/react-native` v14 made
 * `render` and `fireEvent` async, so every query has to be reached through `await`. Nothing about
 * the symptom pointed at that, because destructuring a Promise succeeds and yields `undefined`
 * for each name.
 *
 * Two smaller things had to be right as well, both silent when wrong:
 *
 *  1. v14 peer-depends on a package called **`test-renderer`** — not `react-test-renderer`, which
 *     is what was installed. pnpm did not warn, because the peer was simply absent.
 *  2. Queries are taken from `render()`'s return value rather than the exported `screen`
 *     singleton. jest-expo resolves the library's TypeScript `src/` through the `react-native`
 *     export condition while `main` points at `dist/`, so `screen` can end up in a different
 *     module instance than the `render` meant to populate it. Using the return value cannot be
 *     affected by that.
 *
 * What is asserted here is not styling. It is that the card cannot show a verdict the spike did
 * not measure — the same invariant `probes.test.ts` enforces on the data, now enforced on the
 * thing a human actually reads.
 */

const withStatus = (status: Probe["status"], extra: Partial<Probe> = {}): Probe => ({
  ...PROBES[0],
  status,
  ...extra,
});

describe("ProbeCard", () => {
  it("renders the question and the unit it will be answered in", async () => {
    const { getByText } = await render(<ProbeCard probe={PROBES[0]} />);
    expect(getByText(PROBES[0].question)).toBeTruthy();
    expect(getByText(`Measures: ${PROBES[0].measures}`)).toBeTruthy();
  });

  it("shows NOT RUN before a probe has been measured", async () => {
    const { getByText, queryByText } = await render(<ProbeCard probe={withStatus("pending")} />);
    expect(getByText("NOT RUN")).toBeTruthy();
    // The words that would wrongly imply an answer must not be on screen.
    expect(queryByText("PASS")).toBeNull();
    expect(queryByText("FAIL")).toBeNull();
  });

  it("distinguishes a probe still running from one that has answered", async () => {
    const { getByText, queryByText } = await render(<ProbeCard probe={withStatus("running")} />);
    expect(getByText("RUNNING…")).toBeTruthy();
    expect(queryByText("PASS")).toBeNull();
  });

  it("surfaces the measured distribution alongside a verdict", async () => {
    const { getByText } = await render(
      <ProbeCard
        probe={withStatus("pass", {
          measurement: { value: 0, device: "Pixel 7a" },
          detail: "n=300 · p50 0 · p95 0 · max 0 frames · 100.0% exactly locked",
        })}
      />,
    );
    expect(getByText("PASS")).toBeTruthy();
    // A bare PASS is not enough — the numbers behind it have to be visible on the card.
    expect(getByText(/p95 0/)).toBeTruthy();
    expect(getByText(/100\.0% exactly locked/)).toBeTruthy();
  });

  it("only offers a run button when there is something to run", async () => {
    const { getByText, queryByText } = await render(
      <ProbeCard probe={withStatus("blocked-dev-build")} />,
    );
    expect(getByText("NEEDS CAMERA")).toBeTruthy();
    expect(queryByText("Run probe")).toBeNull();
  });

  it("runs the probe when pressed", async () => {
    const onRun = jest.fn();
    const { getByText } = await render(<ProbeCard probe={withStatus("pending")} onRun={onRun} />);
    await fireEvent.press(getByText("Run probe"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("does not re-run while a measurement is already in flight", async () => {
    const onRun = jest.fn();
    const { getByText } = await render(
      <ProbeCard probe={withStatus("running")} onRun={onRun} disabled />,
    );
    await fireEvent.press(getByText("Measuring…"));
    expect(onRun).not.toHaveBeenCalled();
  });
});
