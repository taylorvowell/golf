import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  jobs as jobsTable,
  swings as swingsTable,
  swingViews as viewsTable,
} from "@/db/schema";
import type { DbTx } from "@/db/session";
import type { ResolvedView } from "@/db/views";

/**
 * Capture-path admission (video-analysis-redesign step 01, item 4).
 *
 * The capture door had neither of the guards the re-analysis door has always had, so a double
 * `source/complete` — a client retry, a response lost on range wifi — minted TWO QStash jobs
 * for one view, and both burned a worker. These tests drive the real `completeCapture` →
 * `startCaptureAnalysis` → `enqueueCapture` chain over a fake transaction whose job table is
 * shared between calls, with only the process edges (QStash, the media store) mocked.
 */

const publishJSON = vi.hoisted(() => vi.fn(async () => ({ messageId: "m1" })));
vi.mock("@upstash/qstash", () => ({
  Client: class {
    publishJSON = publishJSON;
  },
}));

// The bytes are "already in the store" for every test — admission, not upload, is on trial.
vi.mock("@/lib/media/store", () => ({
  getMediaStore: async () => ({ exists: async () => true }),
}));

import { completeCapture } from "./ingest";

type Row = Record<string, unknown>;

/**
 * A transaction double that answers the exact query shapes this path makes, keyed on the
 * schema object each query names — so the job row INSERTED by the first call is the row the
 * second call's `getJob` reads, which is the whole point of the test.
 */
function fakeTx(state: { jobs: Row[] }): DbTx {
  const tx = {
    select: () => {
      let table: unknown;
      let joined = false;
      const q = {
        from(t: unknown) {
          table = t;
          return q;
        },
        innerJoin() {
          joined = true;
          return q;
        },
        where: () => q,
        orderBy: () => q,
        limit: () => q,
        // Thenable, like drizzle's builders — resolution decided by what the query named.
        then(resolve: (rows: Row[]) => void) {
          if (table === swingsTable) return resolve([{ handedness: "right" }]);
          if (table === viewsTable) return resolve([{ rawMediaKey: "raw/original.mp4" }]);
          if (table === jobsTable && joined) {
            return resolve(
              state.jobs
                .filter((j) => j.status === "queued" || j.status === "running")
                .map((j) => ({ id: j.id })),
            );
          }
          if (table === jobsTable) {
            const newest = state.jobs[state.jobs.length - 1];
            return resolve(newest ? [newest] : []);
          }
          return resolve([]);
        },
      };
      return q;
    },
    insert: (t: unknown) => ({
      values: async (values: Row) => {
        if (t === jobsTable) {
          state.jobs.push({
            startedAt: new Date(),
            finishedAt: null,
            lastEventAt: null,
            ...values,
          });
        }
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return tx as unknown as DbTx;
}

const VIEW: ResolvedView = {
  swingId: "22222222-2222-4222-8222-222222222222",
  userId: "11111111-1111-4111-8111-111111111111",
  viewId: "33333333-3333-4333-8333-333333333333",
  view: "dtl",
  mediaKey: "33333333-3333-4333-8333-333333333333",
  revision: 1,
};

const ENV = {
  JOBS_DRIVER: "queue",
  WORKER_CLUB_DETECTOR: "none",
  WORKER_URL: "http://worker.test/jobs",
  APP_INTERNAL_BASE_URL: "http://127.0.0.1:3000",
  QSTASH_URL: "http://qstash.test",
  QSTASH_TOKEN: "test-token",
  WORKER_CALLBACK_SECRET: "test-secret-at-least-16-chars",
} as const;

describe("capture-path admission", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    publishJSON.mockClear();
    for (const [k, v] of Object.entries(ENV)) {
      saved.set(k, process.env[k]);
      process.env[k] = v;
    }
  });

  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("two rapid completeCapture calls mint one job row and one QStash publish", async () => {
    const state = { jobs: [] as Row[] };
    const tx = fakeTx(state);

    const first = await completeCapture(tx, VIEW.userId, VIEW, "video/mp4");
    const second = await completeCapture(tx, VIEW.userId, VIEW, "video/mp4");

    expect(state.jobs).toHaveLength(1);
    expect(publishJSON).toHaveBeenCalledTimes(1);
    // The duplicate delivery is answered with the SAME job — the client polls it as if its
    // own call had won, which is exactly what the route's contract promises.
    expect(second?.id).toBe(first?.id);
    expect(second?.status).toBe("queued");
  });

  it("a failed job does re-enqueue — the advertised retry path stays open", async () => {
    const state = { jobs: [] as Row[] };
    const tx = fakeTx(state);

    const first = await completeCapture(tx, VIEW.userId, VIEW, "video/mp4");
    state.jobs[0].status = "failed";

    const retry = await completeCapture(tx, VIEW.userId, VIEW, "video/mp4");
    expect(retry?.id).not.toBe(first?.id);
    expect(state.jobs).toHaveLength(2);
    expect(publishJSON).toHaveBeenCalledTimes(2);
  });

  it("the per-user cap refuses the capture door too, user-readably", async () => {
    // Three live jobs on OTHER views. The real per-view read filters by viewId and finds
    // nothing for THIS view; the fake mirrors that by answering the unjoined jobs read with
    // an empty set while the ownership-joined count sees all three.
    const others: Row[] = [0, 1, 2].map((i) => ({
      id: `other-${i}`,
      viewId: `view-${i}`,
      status: "running",
    }));
    const tx = {
      select: () => {
        let table: unknown;
        let joined = false;
        const q = {
          from(t: unknown) {
            table = t;
            return q;
          },
          innerJoin() {
            joined = true;
            return q;
          },
          where: () => q,
          orderBy: () => q,
          limit: () => q,
          then(resolve: (rows: Row[]) => void) {
            if (table === swingsTable) return resolve([{ handedness: "right" }]);
            if (table === viewsTable) return resolve([{ rawMediaKey: "raw/original.mp4" }]);
            if (table === jobsTable && joined) {
              return resolve(others.map((j) => ({ id: j.id })));
            }
            return resolve([]); // no job for THIS view yet
          },
        };
        return q;
      },
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    } as unknown as DbTx;

    await expect(
      completeCapture(tx, VIEW.userId, VIEW, "video/mp4"),
    ).rejects.toThrow(/too many analyses in flight/);
    expect(publishJSON).not.toHaveBeenCalled();
  });
});
