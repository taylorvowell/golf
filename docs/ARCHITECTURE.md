# Architecture

The target system for [`PROJECT_MAIN.md`](../.claude/ai-instructions/PROJECT_MAIN.md), decided in
spine step 01. Reasoning for each choice is in [`DECISIONS.md`](DECISIONS.md) D5–D17.

**Almost none of this is built yet.** [`CURRENT-STATE.md`](CURRENT-STATE.md) is what exists —
a Python analyzer and a desktop web player on local Postgres and local disk. This file describes
where that is going, and marks what is real as it lands.

---

## 1. Components

```
┌─────────────────┐         ┌──────────────────────────────┐
│  Mobile app     │         │  Web app (Next.js)           │
│  React Native   │         │  coach workspace · admin ·   │
│  + Expo         │         │  marketing                   │
│  GOLFER surface │         │  COACH + ADMIN surface       │
└────────┬────────┘         └──────────────┬───────────────┘
         │                                 │
         │        versioned HTTP API       │
         └───────────────┬─────────────────┘
                         │
              ┌──────────▼───────────┐
              │  API + job control   │      packages/schema
              │  (Next.js routes)    │      JSON Schema -> TS types
              └──┬────────┬──────────┘      one contract, three consumers
                 │        │
      ┌──────────▼──┐  ┌──▼─────────────┐
      │  Supabase   │  │  Upstash QStash│
      │  Postgres   │  │  dispatch      │
      │  + Auth     │  └──┬─────────────┘
      │  + Storage  │     │
      └──────▲──────┘  ┌──▼──────────────────────────┐
             │         │  Analyzer worker (Railway)  │
             └─────────┤  Python CV pipeline         │
              service  │  UNCHANGED internals        │
              role     └─────────────────────────────┘
```

| Component | Status | Notes |
|---|---|---|
| Analyzer CV pipeline | **built** | Self-contained, JSON-out. Moves hosts without internal change — the property that made this pivot survivable |
| Web player + overlays | **built** | Becomes the coach review surface (D6) rather than being retired |
| Postgres schema + job protocol | **built** | Moves to Supabase; Drizzle retained (D7) |
| Mobile app | not built | Spine step 02 |
| `packages/schema` | not built | Spine step 07 |
| Entitlement engine | not built | Spine step 08 |
| Object storage | not built | Spine step 09 |
| Queue + hosted worker | not built | `analyzer-service` track |

---

## 2. The decisions in one place

| Area | Choice | Why | Entry |
|---|---|---|---|
| Mobile client | React Native + Expo, EAS cloud builds | Windows-only dev machine cannot build iOS at all; existing player logic is TypeScript | D5 |
| Web app role | Coach + admin surface | Coach and admin work is desk-shaped; the player already exists | D6 |
| Database | Supabase Postgres, Drizzle retained | Supabase *is* Postgres; migrations and FKs already exist | D7 |
| Authorization | Row-level security | Coach access is a data rule, not a UI check | D7 |
| Media | Supabase Storage, stable keys | One authorization path for user video | D8 |
| Queue | Upstash QStash dispatch; state in Postgres | Existing job protocol survives the network boundary | D9 |
| Worker | Railway container | GPU availability to be confirmed early | D9 |
| Secrets | Infisical, 3 environments | | D10 |
| Offline | Capture and library offline; analysis online | Golfers record where signal is worst | D11 |
| Releases | EAS Build/Submit; OTA for JS only | No Mac; native changes still need review | D12 |
| SLOs | p95 analysis < 180 s, 0-frame overlay drift | Makes "production ready" falsifiable | D13 |
| AI data | Derived analysis + profile + keyframes; never raw video | Store privacy declarations need an exact answer | D14 |
| Deletion | Cascade across DB, storage, AI history, analytics, backups | Every later track inherits the obligation | D15 |
| AI provider | Server-side seam; model deferred | Keys, cost control, per-tier limits | D16 |
| Entitlement | Ours; receipts are evidence | Survives store outages; admin grants need no purchase | D17 |

---

## 3. The path that matters: record a swing → see the analysis

1. **Capture.** The app records at ≥60 fps, verifying the device can actually deliver it and
   saying so plainly when it cannot (§2.3). The clip and a swing record are written to the
   **local store first** — this step completes with no network (D11).
2. **Trim.** The golfer selects the swing within the recording. Manual for now: automatic
   isolation is deferred (D2), so this fallback is required, not optional.
3. **Upload.** Compressed on-device, then transferred resumably in chunks to Supabase Storage,
   surviving app suspension and connection loss. Queued and retried if offline (D11,
   `media-pipeline`).
4. **Enqueue.** The API creates a job row in Postgres and dispatches via QStash, applying the
   per-user concurrency cap that stops one golfer's batch starving everyone else (D9, §38).
5. **Analyse.** The Railway worker pulls source from storage and runs the **unchanged** pipeline:
   normalize → pose → post-process → events → club → checkpoints → metrics → scoring. It writes
   artifacts back to storage and progress to the job row, using a scoped service role (D7).
6. **Notify.** Analysis completion pushes a notification, because a ~3-minute job means the
   golfer has left the screen (§29, `notifications`).
7. **Render.** The app fetches `analysis.json` plus lazily-fetched sidecars and draws overlays
   locked to the presented video frame. Types come from `packages/schema`, so a contract change
   is a compile error rather than a runtime blank canvas.

---

## 4. Contracts and compatibility

The rule that shapes everything: **a native app cannot be force-updated.** Old versions call
the API for months, and a rendering bug cannot be hotfixed — it waits for review, release, and
the user choosing to update.

- **One schema, three consumers.** JSON Schema in `packages/schema` generates TypeScript for
  both clients; the Python analyzer validates its output against the same schema before writing.
  CI fails on generated-type drift.
- **`analysis.json` evolves additively.** New fields only; never reorder, never repurpose. It is
  already at `schema_version: 9`, and those nine changes were free only because the single client
  shipped in the same commit.
- **The keypoint array is append-only** — 49 entries, measured block after derived, so published
  indices keep their meaning.
- **The API is versioned**, with a written deprecation policy and a minimum-supported-client
  check keyed to the **native build number**, not the JS bundle (OTA can move the bundle
  underneath it — D12).

---

## 5. Security boundaries

1. **RLS is the authorization boundary.** A user reads their own rows; a coach reads a linked
   golfer's rows only through an approved relationship, revocable immediately. Tested in step 03
   against a synthetic relationship, before any coach feature exists — the one bug in this
   product that would be unrecoverable is showing one golfer another golfer's video.
2. **The analyzer's service role bypasses RLS and must be unreachable from request handling.**
   A service role that leaks into a route handler silently voids every policy above it.
3. **Media is only reachable by signed URL**, issued by the same system that decides who may see
   a swing — the reason storage sits with Supabase rather than a separate provider (D8).
4. **No secret reaches a client.** The AI provider and receipt validation are server-side
   precisely because keys, cost ceilings and per-tier limits cannot be enforced on a device
   (D10, D16, D17).
5. **User free text is data, never instruction.** Notes, goals and messages flow into AI prompts
   and must not be able to change system behaviour (D14).

---

## 6. Deliberate deviations from PROJECT_MAIN

Recorded here so the gap between plan and spec never narrows silently.

- **Stripe removed** (§30, §39) in favour of native in-app purchase — the two requirements were
  not simultaneously satisfiable. D1.
- **Automatic swing detection deferred** (§11) to a future phase, with a manual trim fallback
  carrying the workflow meanwhile. D2.
- **Azure not used for media** despite §39's preference, because splitting storage from the auth
  system would create a second authorization path for user video. §39 subordinates preferences to
  capabilities; revisit trigger recorded. D8.

---

## 7. Deploy and rollback

*Filled in by spine step 10.* Note now, because it changes how releases are planned: the web app
and the analyzer roll back like servers; **a mobile binary does not.** A bad native release is
corrected by a new build through store review, or by an OTA JS update if the fault is in
JavaScript — which is the main practical argument for keeping OTA available at all (D12).
