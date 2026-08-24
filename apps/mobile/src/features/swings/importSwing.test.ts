import type { SessionSummary } from "@swingsage/schema/contract";

const mockRequest = jest.fn();
const mockStartProcessing = jest.fn();

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock("../../platform/client", () => ({
  api: { request: (...args: unknown[]) => mockRequest(...args) },
}));
jest.mock("../session/processing", () => ({
  startProcessing: (...args: unknown[]) => mockStartProcessing(...args),
  // `pendingImports` reads these to draw the arriving row on the log. Mocked as inert rather
  // than omitted: a partial module mock leaves them undefined, and the import then fails inside
  // a store this test is not about.
  ANALYSIS_STAGES: ["Uploading", "Queued", "Analyzing pose", "Tracking club", "Scoring"],
  getProcessing: () => null,
  subscribeProcessing: () => () => undefined,
}));

import { importSwing, sessionForToday } from "./importSwing";
import { calendarDate } from "../session/sessionApi";

/**
 * The rule an import adds to the product: **a day is a session.**
 *
 * A golfer emptying a bucket's worth of clips out of their camera roll is describing one practice
 * session, so every clip imported today lands in the same row — including the one session mode
 * already minted this morning. The failure this guards is the opposite: fifteen sessions of one
 * swing each, which makes the log unreadable and every per-session average meaningless.
 */

const TODAY = calendarDate(new Date());

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "existing",
    date: TODAY,
    name: null,
    sessionType: "swing_analysis",
    swingCount: 2,
    createdAt: 0,
    ...over,
  };
}

const CLIP = { uri: "/library/clip.mp4", fileName: "clip.mp4", durationMs: 8_000, sizeBytes: 10 };

beforeEach(() => {
  mockRequest.mockReset();
  mockStartProcessing.mockReset();
});

it("joins the session already recorded today rather than minting another", async () => {
  const id = await sessionForToday([session({ id: "this-morning" })]);
  expect(id).toBe("this-morning");
  // Nothing was created, and nothing was even asked of the server: the cached list answered it.
  expect(mockRequest).not.toHaveBeenCalled();
});

it("ignores a session from another day", async () => {
  // GET and POST share the path, so the mock branches on the method the way the server does.
  mockRequest.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST") return Promise.resolve({ session: session({ id: "fresh" }) });
    return Promise.resolve({ sessions: [session({ date: "2020-01-01" })] });
  });
  const id = await sessionForToday([session({ id: "yesterday", date: "2020-01-01" })]);
  expect(id).toBe("fresh");
});

it("creates exactly one session when two imports start at once", async () => {
  // The obvious bug: both find no session for today and both create one, so a golfer who picked
  // two clips in quick succession gets two sessions of one swing.
  let creates = 0;
  mockRequest.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method !== "POST") return Promise.resolve({ sessions: [] });
    creates += 1;
    return Promise.resolve({ session: session({ id: "created" }) });
  });

  const [a, b] = await Promise.all([sessionForToday([]), sessionForToday([])]);
  expect(a).toBe("created");
  expect(b).toBe("created");
  expect(creates).toBe(1);
});

it("re-reads the server before creating, so a session minted since the cache still wins", async () => {
  // The cache can predate a session that session mode created minutes ago, and joining THAT one
  // is the whole point of grouping by day.
  mockRequest.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      throw new Error("must not create a session when one already exists for today");
    }
    return Promise.resolve({ sessions: [session({ id: "just-minted" })] });
  });
  expect(await sessionForToday([])).toBe("just-minted");
});

it("runs an imported clip through the same pipeline a recorded swing uses", async () => {
  await importSwing({
    clip: CLIP,
    view: "face_on",
    handedness: "left",
    sessions: [session({ id: "today" })],
  });

  expect(mockStartProcessing).toHaveBeenCalledTimes(1);
  const [, input] = mockStartProcessing.mock.calls[0] as [string, Record<string, unknown>];
  expect(input).toMatchObject({
    view: "face_on",
    handedness: "left",
    sessionId: "today",
    // An import is analysed like anything else — there is no second kind of swing.
    analyze: true,
  });
  // fps is 0, not a guess: the app did not record this file and the analyzer probes the real
  // rate off the clip. Stating a number here would be inventing one nothing reads.
  expect((input.clip as { fps: number }).fps).toBe(0);
  expect((input.clip as { path: string }).path).toBe(CLIP.uri);
});
