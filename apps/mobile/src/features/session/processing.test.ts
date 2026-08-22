import type { Job } from "@swingsage/schema/contract";

// `mock`-prefixed so jest's out-of-scope guard allows the factories below to close over them.
const mockUploadAsync = jest.fn();
const mockRequest = jest.fn();

jest.mock("expo-file-system/legacy", () => ({
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

jest.mock("../../platform/client", () => ({
  api: {
    request: (...args: unknown[]) => mockRequest(...args),
    uploadTarget: async (url: string, headers: Record<string, string>) => ({
      url: `http://api.test${url}`,
      headers: { ...headers, Authorization: "Bearer test" },
    }),
  },
}));

import {
  clearProcessing,
  getProcessing,
  startProcessing,
  subscribeProcessing,
  type ProcessingInput,
} from "./processing";

/**
 * The pipeline's promises, pinned:
 *
 *  - the stage shown is the stage the JOB reports, and it never goes backwards;
 *  - a video-only session uploads the clip and enqueues NOTHING;
 *  - a failure at any leg is terminal, named, and never claims the video was lost.
 *
 * Everything here drives the real module — the two things stubbed are the ones that would talk
 * to a network and a filesystem, which is exactly the boundary this file exists to hold.
 */

const CLIP = { path: "/cache/swing.mp4", fps: 240, durationMs: 6_000 };

const input = (over: Partial<ProcessingInput> = {}): ProcessingInput => ({
  clip: CLIP,
  view: "dtl",
  handedness: "right",
  sessionId: "session-1",
  analyze: true,
  ...over,
});

function job(over: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    viewId: "view-1",
    status: "running",
    stage: "pose",
    progressPct: 40,
    message: "",
    log: [],
    startedAt: 0,
    finishedAt: null,
    ...over,
  } as Job;
}

/** Wait until `predicate` holds, letting the module's own awaits and timers run. */
async function until(predicate: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
  }
  throw new Error("condition never held");
}

beforeEach(() => {
  jest.useFakeTimers();
  clearProcessing();
  mockUploadAsync.mockReset();
  mockRequest.mockReset();
  mockUploadAsync.mockResolvedValue({ status: 200 });
});

afterEach(() => {
  jest.useRealTimers();
});

it("walks upload → queued → the analyzer's own stages → done", async () => {
  const polls: Job[] = [
    job({ status: "queued", stage: "queued" }),
    job({ status: "running", stage: "normalize" }),
    job({ status: "running", stage: "pose" }),
    job({ status: "running", stage: "club" }),
    job({ status: "done", stage: "complete" }),
  ];
  let poll = 0;
  mockRequest.mockImplementation((path: string) => {
    if (path === "swings") return Promise.resolve({ swingId: "s1", viewId: "v1", upload: { url: "/api/v1/up", method: "PUT", headers: {} } });
    if (path.endsWith("/source/complete")) return Promise.resolve(job({ status: "queued" }));
    return Promise.resolve(polls[Math.min(poll++, polls.length - 1)]);
  });

  const seen: string[] = [];
  subscribeProcessing("local-1", () => {
    const s = getProcessing("local-1");
    if (s && seen[seen.length - 1] !== s.stage) seen.push(s.stage);
  });
  startProcessing("local-1", input());

  await until(() => getProcessing("local-1")?.phase === "done");

  const state = getProcessing("local-1");
  expect(state?.swingId).toBe("s1");
  expect(state?.viewId).toBe("v1");
  // The bar reached Scoring's neighbourhood by walking, never by jumping — and the label always
  // came from the job, so a queue nobody drains would have stopped at "Queued".
  expect(seen[0]).toBe("Uploading");
  expect(seen).toContain("Queued");
  expect(state?.stageIndex).toBeGreaterThanOrEqual(3);
});

it("never lets the stage go backwards when a stage name is not recognised", async () => {
  const polls: Job[] = [
    job({ status: "running", stage: "club" }),
    job({ status: "running", stage: "something-new" }),
    job({ status: "done", stage: "complete" }),
  ];
  let poll = 0;
  mockRequest.mockImplementation((path: string) => {
    if (path === "swings") return Promise.resolve({ swingId: "s1", viewId: "v1", upload: { url: "/api/v1/up", method: "PUT", headers: {} } });
    if (path.endsWith("/source/complete")) return Promise.resolve(job({ status: "queued" }));
    return Promise.resolve(polls[Math.min(poll++, polls.length - 1)]);
  });

  let lowest = 99;
  let highest = 0;
  subscribeProcessing("local-2", () => {
    const s = getProcessing("local-2");
    if (!s) return;
    // An unknown stage that reset the track would read as the analysis starting over.
    if (s.stageIndex < highest) lowest = Math.min(lowest, s.stageIndex);
    highest = Math.max(highest, s.stageIndex);
  });
  startProcessing("local-2", input());

  await until(() => getProcessing("local-2")?.phase === "done");
  expect(lowest).toBe(99);
});

it("uploads a video-only swing and enqueues nothing", async () => {
  mockRequest.mockImplementation((path: string) => {
    if (path === "swings") return Promise.resolve({ swingId: "s1", viewId: "v1", upload: { url: "/api/v1/up", method: "PUT", headers: {} } });
    if (path.endsWith("/source/complete")) return Promise.resolve({ status: "idle" });
    throw new Error(`a video-only swing must not poll a job (asked for ${path})`);
  });

  startProcessing("local-3", input({ analyze: false }));
  await until(() => getProcessing("local-3")?.phase === "done");

  // The clip still went up: skipping ingest would leave the only copy of the swing in a cache
  // directory the app sweeps.
  expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  const complete = mockRequest.mock.calls.find(([p]) => String(p).endsWith("/source/complete"));
  expect(JSON.parse(String((complete?.[1] as { body: string }).body)).analyze).toBe(false);
});

it("reports a refused upload as a failure that names what happened", async () => {
  mockRequest.mockImplementation((path: string) => {
    if (path === "swings") return Promise.resolve({ swingId: "s1", viewId: "v1", upload: { url: "/api/v1/up", method: "PUT", headers: {} } });
    throw new Error("should not reach completion");
  });
  mockUploadAsync.mockResolvedValue({ status: 413 });

  startProcessing("local-4", input());
  await until(() => getProcessing("local-4")?.phase === "failed");

  const state = getProcessing("local-4");
  expect(state?.message).toMatch(/413/);
  // The swing row exists even though the bytes did not land — a visible, deletable row rather
  // than an upload with nothing behind it.
  expect(state?.swingId).toBe("s1");
});

it("starts one run per swing, however many times a screen mounts", async () => {
  mockRequest.mockImplementation((path: string) => {
    if (path === "swings") return Promise.resolve({ swingId: "s1", viewId: "v1", upload: { url: "/api/v1/up", method: "PUT", headers: {} } });
    if (path.endsWith("/source/complete")) return Promise.resolve({ status: "idle" });
    throw new Error("no polling expected");
  });

  startProcessing("local-5", input({ analyze: false }));
  startProcessing("local-5", input({ analyze: false }));
  startProcessing("local-5", input({ analyze: false }));
  await until(() => getProcessing("local-5")?.phase === "done");

  // A second upload would mint a second swing row for one hit.
  expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  expect(mockRequest.mock.calls.filter(([p]) => p === "swings")).toHaveLength(1);
});
