import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { withUser } from "@/db/session";
import {
  GOAL_VALUES,
  golferGoals,
  golferProfiles,
  users,
  type GolferGoal,
  type GolferProfileRow,
} from "@/db/schema";

/**
 * Reading and writing §5's profile, on the server side.
 *
 * The shape crossing the wire has two halves for the same reason the schema does: `public` is what
 * a coach directory or a shared swing may show, `private` is everything §5.2/§5.4/§5.5 collects.
 * A single flat body would have made the split a convention that every future field has to
 * remember; two objects make putting a field in the wrong one visible in a diff.
 *
 * Goals are part of the profile on the wire and a separate table underneath, because §5.3 needs
 * them ordered and capped and a golfer edits them as one set — three writes to describe "these are
 * my goals now" is an interface that will eventually be called partially.
 */

/** The eight §5.3 goals, exported for validation and for clients that render the picker. */
export const GOALS: readonly GolferGoal[] = GOAL_VALUES;

export function isGoal(value: unknown): value is GolferGoal {
  return typeof value === "string" && (GOAL_VALUES as readonly string[]).includes(value);
}

/** Fields a client may write. Identity, timestamps and the goal set are handled separately. */
const WRITABLE = [
  "handedness", "selfReportedStyle", "skillLevel", "handicapRange",
  "typicalMissDriver", "typicalMissIrons", "averageScore", "driverSwingSpeedMph",
  "sevenIronCarryYds", "fittedStatus", "fittedYear", "gripSize", "physicalLimitations",
  "launchMonitorAccess", "practiceAccess", "roundsPerMonth", "practiceSessionsPerWeek",
  "altitudeFt", "climate", "heightCm", "wingspanCm", "wristToFloorCm", "ageRange",
  "yearsPlaying", "mobilityScreen", "workingWithCoach", "swingChangeInProgress",
  "preferredShotShape", "coachingStyle", "feedbackDepth",
] as const satisfies readonly (keyof GolferProfileRow)[];

export type WritableProfileField = (typeof WRITABLE)[number];

export interface ProfileBody {
  public: { displayName: string; avatarUrl: string | null; bio: string | null; region: string | null };
  private: Partial<Record<WritableProfileField, unknown>> & { onboardingCompletedAt: string | null };
  goals: GolferGoal[];
}

export class ProfileError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * The caller's whole profile.
 *
 * A golfer who has never opened onboarding has no `golfer_profiles` row at all — that is normal,
 * not an error, because §45 requires an account to reach a swing before it has answered anything.
 * The absent row reads as an empty private half rather than a 404.
 */
export async function readProfile(userId: string): Promise<ProfileBody> {
  return withUser(userId, async (tx) => {
    const [account] = await tx.select({
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      region: users.region,
    }).from(users).where(eq(users.id, userId)).limit(1);

    const [profile] = await tx.select().from(golferProfiles)
      .where(eq(golferProfiles.userId, userId)).limit(1);

    const goalRows = await tx.select({ goal: golferGoals.goal, rank: golferGoals.rank })
      .from(golferGoals).where(eq(golferGoals.userId, userId));

    const priv: Record<string, unknown> = {};
    for (const field of WRITABLE) priv[field] = profile ? profile[field] : null;

    return {
      public: {
        displayName: account?.displayName ?? "",
        avatarUrl: account?.avatarUrl ?? null,
        bio: account?.bio ?? null,
        region: account?.region ?? null,
      },
      private: {
        ...priv,
        onboardingCompletedAt: profile?.onboardingCompletedAt?.toISOString() ?? null,
      },
      goals: goalRows.sort((a, b) => a.rank - b.rank).map((r) => r.goal),
    } as ProfileBody;
  });
}

export interface ProfilePatch {
  public?: Partial<{ displayName: string; avatarUrl: string | null; bio: string | null; region: string | null }>;
  private?: Partial<Record<WritableProfileField, unknown>>;
  /** The complete goal set, in the golfer's order. Absent leaves goals alone; `[]` clears them. */
  goals?: GolferGoal[];
  /** Set once onboarding's required answers exist. Idempotent. */
  completeOnboarding?: boolean;
}

/**
 * Apply a partial update. Everything in one transaction, so a half-written profile is not a state
 * a client can observe — an onboarding screen submits several answers at once and a partial apply
 * would leave the resume point lying about where the golfer got to.
 */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileBody> {
  if (patch.goals) {
    // Validated before the transaction opens so a bad body is a 400 rather than a rolled-back
    // write. The 2-3 cap is also a database rule (migration 0012) — this is the message, not the
    // enforcement.
    const unknown = patch.goals.filter((g) => !isGoal(g));
    if (unknown.length) {
      throw new ProfileError("unknown_goal", `not a selectable goal: ${unknown.join(", ")}`);
    }
    if (new Set(patch.goals).size !== patch.goals.length) {
      throw new ProfileError("duplicate_goal", "the same goal was selected twice");
    }
    if (patch.goals.length > 3) {
      throw new ProfileError("too_many_goals", "at most 3 goals may be selected");
    }
  }

  await withUser(userId, async (tx) => {
    if (patch.public && Object.keys(patch.public).length) {
      await tx.update(users).set(patch.public).where(eq(users.id, userId));
    }

    const priv = patch.private ?? {};
    const fields = Object.keys(priv).filter((k): k is WritableProfileField =>
      (WRITABLE as readonly string[]).includes(k));
    const unknownFields = Object.keys(priv).filter((k) => !(WRITABLE as readonly string[]).includes(k));
    if (unknownFields.length) {
      // Loud, not ignored. A typo'd field silently dropped is a golfer answering a question the
      // product then behaves as if they never answered.
      throw new ProfileError("unknown_field", `not a profile field: ${unknownFields.join(", ")}`);
    }

    const values = Object.fromEntries(fields.map((f) => [f, priv[f]]));
    const needsRow = fields.length > 0 || patch.completeOnboarding;
    if (needsRow) {
      const set = {
        ...values,
        updatedAt: new Date(),
        ...(patch.completeOnboarding ? { onboardingCompletedAt: new Date() } : {}),
      };
      await tx.insert(golferProfiles)
        .values({ userId, ...set })
        .onConflictDoUpdate({ target: golferProfiles.userId, set });
    }

    if (patch.goals) {
      // Replace, never merge: the client sends the complete set because that is how a golfer
      // thinks about it, and a merge would make "remove this goal" unexpressible.
      await tx.delete(golferGoals).where(eq(golferGoals.userId, userId));
      if (patch.goals.length) {
        await tx.insert(golferGoals).values(
          patch.goals.map((goal, i) => ({ userId, goal, rank: i + 1 })),
        );
      }
    }
  });

  return readProfile(userId);
}

/**
 * Whether onboarding's one REQUIRED answer (§5.4: handedness) is on file.
 *
 * Everything else in onboarding is skippable, so this — not "every field is filled" — is what
 * "the minimum viable profile" means, and what a client checks to decide whether to resume.
 */
export async function onboardingState(userId: string): Promise<{
  required: { handedness: boolean };
  complete: boolean;
}> {
  const rows = await withUser(userId, (tx) =>
    tx.execute<{ handedness: string | null; done: string | null }>(sql`
      select handedness, onboarding_completed_at::text as done
        from public.golfer_profiles where user_id = ${userId}
    `));
  const row = rows[0];
  return {
    required: { handedness: Boolean(row?.handedness) },
    complete: Boolean(row?.done),
  };
}
