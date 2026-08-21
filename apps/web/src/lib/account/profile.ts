import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { withUser } from "@/db/session";
import { golferProfiles, users, type GolferProfileRow } from "@/db/schema";

/**
 * Reading and writing §5's profile, on the server side.
 *
 * The shape crossing the wire has two halves for the same reason the schema does: `public` is what
 * a coach directory or a shared swing may show, `private` is what the product asks the golfer.
 * A single flat body would have made the split a convention that every future field has to
 * remember; two objects make putting a field in the wrong one visible in a diff.
 *
 * Goals are deliberately NOT here (Taylor, 2026-08-20): they belong to the guidance features,
 * not to the profile, and `golfer_goals` was dropped with them (migration 0015).
 */

/** Fields a client may write — exactly the six the product asks (2026-08-20 cut). Identity and
 *  timestamps are handled separately; a field the product does not ask about has no business
 *  being writable. */
const WRITABLE = [
  "handedness", "selfReportedStyle", "handicapRange", "ageRange",
  "driverSwingSpeedMph", "sevenIronCarryYds",
] as const satisfies readonly (keyof GolferProfileRow)[];

export type WritableProfileField = (typeof WRITABLE)[number];

export interface ProfileBody {
  public: { displayName: string; avatarUrl: string | null; bio: string | null; region: string | null };
  private: Partial<Record<WritableProfileField, unknown>> & { onboardingCompletedAt: string | null };
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
    } as ProfileBody;
  });
}

export interface ProfilePatch {
  public?: Partial<{ displayName: string; avatarUrl: string | null; bio: string | null; region: string | null }>;
  private?: Partial<Record<WritableProfileField, unknown>>;
  /** Set once onboarding's required answers exist. Idempotent. */
  completeOnboarding?: boolean;
}

/**
 * Apply a partial update. Everything in one transaction, so a half-written profile is not a state
 * a client can observe — an onboarding screen submits several answers at once and a partial apply
 * would leave the resume point lying about where the golfer got to.
 */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileBody> {
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
