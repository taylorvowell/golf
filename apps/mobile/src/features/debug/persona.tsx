import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Crown,
  GraduationCap,
  Hourglass,
  ShieldCheck,
  Sparkles,
  Sprout,
  TrendingUp,
} from "lucide-react-native";

import { PortraitPicker } from "../../design/system";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../auth/supabase";
import { useEntitlementScenario } from "../billing/entitlement";
import { useDebugGroups } from "./DebugOverlay";

/**
 * Debug personas — become a KIND of user by ACTUALLY SIGNING IN as them. Each persona is a
 * real seeded account on the dev auth project (`apps/web/scripts/seed-persona-auth.mjs`) with
 * its own name and — for the populated personas — real analysed swings in the production
 * database, so every surface shows exactly what that user sees. There is NO mock mode: real
 * data always (Taylor, 2026-08-24). Leaving a persona is an ordinary sign-out; you sign back
 * in as yourself the normal way.
 *
 * The active persona is DERIVED from the session's email, never stored — whoever is actually
 * signed in IS the state, and it survives relaunches for free.
 *
 * The tiles sit inline at the top of the debug sheet (the coach picker's control, compact,
 * with a tiny caption under each name). "Existing" (Marcus Webb) is the default highlight —
 * the account a demo starts from.
 *
 * The entitlement scenario is still forced client-side per persona — billing has no server
 * state yet; the seeded subscription rows take over when it does.
 *
 * Dev-only: the hook pins to null outside `__DEV__`, the selector registers via
 * `DebugProvider` (no-op in release), and the shared password lives only in machine-local env
 * (`EXPO_PUBLIC_PERSONA_PASSWORD`).
 */

export type PersonaId =
  | "new-user"
  | "newby"
  | "existing"
  | "trial"
  | "pro"
  | "coach"
  | "admin";

interface PersonaDef {
  id: PersonaId;
  /** Card name — short, the tile truncates at one line. */
  label: string;
  /** The tiny on-card caption — what this user IS, in a few words. */
  caption: string;
  /** Spoken description for the tile (the caption is too terse to be the a11y label). */
  blurb: string;
  /** The entitlement scenario this persona forces (`SCENARIOS` id). */
  scenario: string;
}

/**
 * The seeded account behind each persona — email must match `seed-persona-auth.mjs` exactly.
 * Names are real-looking on purpose: the demo has to read as a person, not a test row.
 */
export const PERSONA_ACCOUNTS: Record<PersonaId, { email: string; fullName: string }> = {
  "new-user": { email: "persona-new@swingsage.dev", fullName: "Jordan Lee" },
  newby: { email: "persona-newby@swingsage.dev", fullName: "Priya Nair" },
  existing: { email: "persona-existing@swingsage.dev", fullName: "Marcus Webb" },
  trial: { email: "persona-trial@swingsage.dev", fullName: "Danny Ortiz" },
  pro: { email: "persona-pro@swingsage.dev", fullName: "Sophie Chen" },
  coach: { email: "persona-coach@swingsage.dev", fullName: "Dave Kim" },
  admin: { email: "persona-admin@swingsage.dev", fullName: "Alex Morgan" },
};

/** One shared password for every persona account, set at seed time. Dev machines only. */
const PERSONA_PASSWORD = process.env.EXPO_PUBLIC_PERSONA_PASSWORD;

export const PERSONAS: PersonaDef[] = [
  {
    id: "new-user",
    label: "New user",
    caption: "Just signed up",
    blurb: "Jordan Lee — just signed up, nothing yet.",
    scenario: "free-never",
  },
  {
    id: "newby",
    label: "Newby",
    caption: "No swings yet",
    blurb: "Priya Nair — has been here before, never recorded.",
    scenario: "free-never",
  },
  {
    id: "existing",
    label: "Existing",
    caption: "Swings · Free",
    blurb: "Marcus Webb — analysed swings on Free. The default demo.",
    scenario: "free-never",
  },
  {
    id: "trial",
    label: "Trial",
    caption: "Pro trial",
    blurb: "Danny Ortiz — swings on a fresh Pro trial.",
    scenario: "trial-fresh",
  },
  {
    id: "pro",
    label: "Pro",
    caption: "Subscribed",
    blurb: "Sophie Chen — subscribed; no upsells.",
    scenario: "pro-healthy",
  },
  {
    id: "coach",
    label: "Instructor",
    caption: "Coaches students",
    blurb: "Dave Kim — Instructor tier, coaches Marcus.",
    scenario: "inst-gold",
  },
  {
    id: "admin",
    label: "Admin",
    caption: "Operator",
    blurb: "Alex Morgan — the operator's account.",
    scenario: "pro-healthy",
  },
];

/** The persona behind an email — the signed-in session IS the persona state. */
export function personaForEmail(email: string | null): PersonaId | null {
  if (!email) return null;
  const hit = (Object.keys(PERSONA_ACCOUNTS) as PersonaId[]).find(
    (id) => PERSONA_ACCOUNTS[id].email === email,
  );
  return hit ?? null;
}

/** The active persona — whoever is actually signed in. Null for Taylor's own account and
 *  always null in release. */
export function usePersona(): PersonaId | null {
  const { email } = useAuth();
  return __DEV__ ? personaForEmail(email) : null;
}

/** Personas whose account has never recorded a swing — the home's first-swing shape. */
export function personaHasNoSwings(persona: PersonaId | null): boolean {
  return persona === "new-user" || persona === "newby";
}

/**
 * The subscription states each persona can COHERENTLY be in — what the debug sheet's
 * "Subscription state" chips are filtered to (a Pro subscriber cannot be mid-trial; a user
 * who just signed up has no payment history to be in grace over). Null persona (Taylor's own
 * account) sees everything. Empty list = the group hides entirely for that persona.
 */
const PRO_STATES = ["pro-healthy", "pro-low", "pro-spent", "grace", "hold"];
const INSTRUCTOR_STATES = [
  "inst-free",
  "inst-free-pro",
  "inst-gold",
  "inst-platinum",
  "inst-gold-grace",
  "inst-gold-hold",
];
export const PERSONA_SCENARIOS: Record<PersonaId, string[]> = {
  "new-user": [],
  newby: [],
  existing: ["free-never", "free-expired"],
  trial: ["trial-fresh", "trial-ending"],
  pro: PRO_STATES,
  // The instructor persona flips across the whole membership dimension — free membership on
  // both personal tiers, the paid memberships with Pro included, and the two payment-recovery
  // states. Never a trial: trials are a golfer concept.
  coach: INSTRUCTOR_STATES,
  // The operator flips anything — admin is the debugging persona.
  admin: [
    "trial-fresh",
    "trial-ending",
    ...PRO_STATES,
    ...INSTRUCTOR_STATES,
    "free-never",
    "free-expired",
  ],
};

const PERSONA_GLYPH: Record<PersonaId, typeof Sparkles> = {
  "new-user": Sparkles,
  newby: Sprout,
  existing: TrendingUp,
  trial: Hourglass,
  pro: Crown,
  coach: GraduationCap,
  admin: ShieldCheck,
};

/**
 * Sign-out FIRST is deliberate — the SIGNED_OUT event is what clears every per-user cache
 * (swing list, reports); signing straight into the next account would leak the previous
 * user's data across the boundary. If the sign-in then fails (offline, not seeded), the
 * device rests on the sign-in screen — an honest dev-tool failure, reported in the console.
 */
async function signInAsPersona(def: PersonaDef): Promise<void> {
  if (!PERSONA_PASSWORD) {
    console.warn("[persona] EXPO_PUBLIC_PERSONA_PASSWORD missing — run the persona seeder");
    return;
  }
  const account = PERSONA_ACCOUNTS[def.id];
  await supabase.auth.signOut();
  const { error } = await supabase.auth.signInWithPassword({
    email: account.email,
    password: PERSONA_PASSWORD,
  });
  if (error) console.warn(`[persona] sign-in as ${account.email} failed: ${error.message}`);
}

/** The first tile is Taylor himself — tapping it signs the persona out so he can sign back
 *  in as his own account. His avatar is remembered device-locally, so the tile keeps his
 *  face even while a persona's session is the active one. */
const ME_ID = "me";
const ME_KEY = "swingsage.debug.me.v1";

export function PersonaDebug() {
  const persona = usePersona();
  const { setScenarioId } = useEntitlementScenario();
  const { email, avatarUrl } = useAuth();
  const t = useTheme();

  const [meAvatar, setMeAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (!__DEV__) return;
    void AsyncStorage.getItem(ME_KEY).then((raw) => {
      if (!raw) return;
      try {
        const stored = JSON.parse(raw) as { avatarUrl?: string | null };
        setMeAvatar((current) => current ?? stored.avatarUrl ?? null);
      } catch {
        // Unreadable stored face falls back to the initial — harmless.
      }
    });
  }, []);
  useEffect(() => {
    if (!__DEV__) return;
    if (email && !personaForEmail(email) && avatarUrl) {
      setMeAvatar(avatarUrl);
      void AsyncStorage.setItem(ME_KEY, JSON.stringify({ avatarUrl }));
    }
  }, [email, avatarUrl]);

  // A persona session that survived a relaunch still needs its entitlement scenario forced —
  // the entitlement provider reset with the JS world, but the signed-in user did not.
  useEffect(() => {
    if (!__DEV__) return;
    const def = PERSONAS.find((p) => p.id === personaForEmail(email));
    if (def) setScenarioId(def.scenario);
  }, [email, setScenarioId]);

  // Inline at the TOP of the debug sheet — pick a tile right there (Taylor, 2026-08-24).
  const groups = useMemo(() => {
    const glyph = (Icon: typeof Sparkles) => <Icon size={22} color={t.cobalt} strokeWidth={2} />;
    return [
      {
        title: "Persona",
        content: (
          <PortraitPicker
            testIDPrefix="persona-option"
            columns={4}
            compact
            options={[
              {
                id: ME_ID,
                name: "Taylor",
                caption: "Your account",
                image: meAvatar ? { uri: meAvatar } : undefined,
              },
              ...PERSONAS.map((def) => ({
                id: def.id,
                name: def.label,
                caption: def.caption,
                art: glyph(PERSONA_GLYPH[def.id]),
              })),
            ]}
            selectedId={persona ?? ME_ID}
            onSelect={(id) => {
              if (id === ME_ID) {
                // Back to Taylor: sign the persona out; he signs in as himself from there.
                if (personaForEmail(email)) void supabase.auth.signOut();
                return;
              }
              const def = PERSONAS.find((p) => p.id === id);
              if (!def) return;
              setScenarioId(def.scenario);
              // Re-tapping the active persona just resets its base subscription state —
              // no pointless sign-out/in round trip.
              if (def.id !== persona) void signInAsPersona(def);
            }}
            accessibilityLabelFor={(o) =>
              o.id === ME_ID
                ? "Taylor. Your own account — signs the persona out."
                : (PERSONAS.find((p) => p.id === o.id)?.blurb ?? o.name)
            }
          />
        ),
      },
    ];
  }, [email, meAvatar, persona, setScenarioId, t]);
  useDebugGroups("persona", groups);

  return null;
}
