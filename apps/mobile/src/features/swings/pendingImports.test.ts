import { act, renderHook } from "@testing-library/react-native";

const mockGetProcessing = jest.fn();
const mockSubscribe = jest.fn();

jest.mock("../session/processing", () => ({
  ANALYSIS_STAGES: ["Uploading", "Queued", "Analyzing pose", "Tracking club", "Scoring"],
  getProcessing: (...args: unknown[]) => mockGetProcessing(...args),
  subscribeProcessing: (...args: unknown[]) => mockSubscribe(...args),
}));

import {
  clearPendingImports,
  setOrphanCleanup,
  trackImport,
  usePendingImports,
} from "./pendingImports";

/**
 * What the log promises about a swing that has not landed yet.
 *
 * The row exists to show something HAPPENING. So it appears before a byte has moved, it tracks
 * the pipeline's own stage, and — the rule Taylor set on 2026-08-22 — **it leaves the moment the
 * run fails.** The session list is where a golfer looks at their practice, not where they debug
 * an upload; the toast and the inbox carry a failure instead.
 */

/** The pipeline listener the store registered — a test drives the run through this. */
let notify: () => void;

async function emit(phase: string, over: Record<string, unknown> = {}): Promise<void> {
  mockGetProcessing.mockReturnValue({
    phase,
    stage: "Uploading",
    stageIndex: 0,
    swingId: null,
    viewId: null,
    message: null,
    analysisStarted: false,
    ...over,
  });
  await act(async () => notify());
}

beforeEach(() => {
  clearPendingImports();
  setOrphanCleanup(null);
  mockGetProcessing.mockReset();
  mockSubscribe.mockReset();
  mockSubscribe.mockImplementation((_id: string, listener: () => void) => {
    notify = listener;
    return () => {};
  });
});

it("shows the row from the moment the import starts, before a byte has moved", async () => {
  const { result } = await renderHook(() => usePendingImports());
  await act(async () => {
    trackImport("import-1", "session-1", 1000);
  });

  expect(result.current).toHaveLength(1);
  expect(result.current[0]).toMatchObject({
    localId: "import-1",
    sessionId: "session-1",
    stage: "Uploading",
  });
});

it("tracks the stage while the run is still going", async () => {
  const { result } = await renderHook(() => usePendingImports());
  await act(async () => {
    trackImport("import-2", "session-1", 1000);
  });

  await emit("running", { stage: "Analyzing pose", stageIndex: 2 });

  expect(result.current[0]).toMatchObject({ stage: "Analyzing pose", stageIndex: 2 });
});

it("takes a failed row straight off the log", async () => {
  const { result } = await renderHook(() => usePendingImports());
  await act(async () => {
    trackImport("import-3", "session-1", 1000);
  });

  await emit("failed", { message: "the upload was refused (400)", swingId: "swing-9" });

  expect(result.current).toHaveLength(0);
});

it("cleans up the empty swing when the clip never reached the server", async () => {
  const orphans: string[] = [];
  setOrphanCleanup((id) => orphans.push(id));
  await renderHook(() => usePendingImports());
  await act(async () => {
    trackImport("import-4", "session-1", 1000);
  });

  // Ingest minted the row and then the bytes did not land — a swing with no video, and never any.
  await emit("failed", { swingId: "swing-9", analysisStarted: false });

  expect(orphans).toEqual(["swing-9"]);
});

it("never deletes a swing whose video DID reach the server", async () => {
  const orphans: string[] = [];
  setOrphanCleanup((id) => orphans.push(id));
  await renderHook(() => usePendingImports());
  await act(async () => {
    trackImport("import-5", "session-1", 1000);
  });

  // The analyzer ran and failed. The golfer has a video on the server; a failed analysis is
  // never a reason to destroy footage.
  await emit("failed", { swingId: "swing-9", analysisStarted: true });

  expect(orphans).toEqual([]);
});

it("starts one row per import, however many times a screen mounts", async () => {
  await renderHook(() => usePendingImports());
  await act(async () => {
    trackImport("import-6", "session-1", 1000);
    trackImport("import-6", "session-1", 1000);
  });
  expect(mockSubscribe).toHaveBeenCalledTimes(1);
});
