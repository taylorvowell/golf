import type { ImageSourcePropType } from "react-native";

/**
 * The AI coach roster — three personas the golfer picks between, each a different voice and
 * a different coaching manner over the SAME deterministic engines. The persona is presentation
 * only: it never changes a fact, a score or an abstention (`docs/decisions/analysis-and-ai.md`
 * — "the Coach is a persona over deterministic systems").
 *
 * `voice` is the Gemini TTS voice the persona's D57 line bank is rendered with, so the
 * pre-generated asset bank keys off this id + voice pair. Adding a coach means a whole
 * regenerated bank for that persona, never a runtime TTS call.
 *
 * Portraits live in `assets/coaches/<id>.jpg` — square, bundled, drawn as a circle everywhere.
 *
 * **`portrait` is OPTIONAL, and that is load-bearing.** `require` resolves at BUNDLE time, so a
 * portrait that is missing or renamed is not a blank avatar — it is a Metro 500 and an app that
 * dies on launch with a stack trace about a PNG (2026-08-22). A roster entry may therefore ship
 * without art; `CoachAvatar` draws the coach's initial instead, and nobody is locked out of the
 * app because a picture is mid-swap.
 */

export type CoachId = "mark" | "sean" | "julie";

/** The Gemini prebuilt voice names the bank renders with. */
export type CoachVoice = "Orus" | "Charon" | "Zephyr";

export interface Coach {
  id: CoachId;
  /** How the coach signs their guidance. */
  name: string;
  voice: CoachVoice;
  /** How the voice SOUNDS, in a golfer's words — the Gemini id above is never rendered. */
  voiceLabel: string;
  /** The one line that tells a golfer what changes if they pick this coach. */
  style: string;
  /** Absent while a portrait is being added or replaced — never a reason to fail the bundle. */
  portrait?: ImageSourcePropType;
}

export const COACHES: readonly Coach[] = [
  {
    id: "mark",
    name: "Mark",
    voice: "Orus",
    voiceLabel: "Measured baritone",
    style: "Direct and technical — the cause first, then the fix.",
    portrait: require("../../../assets/coaches/mark.jpg") as ImageSourcePropType,
  },
  {
    id: "sean",
    name: "Sean",
    voice: "Charon",
    voiceLabel: "Warm and low",
    style: "Calm and steady — one thing at a time, no rush.",
    portrait: require("../../../assets/coaches/sean.jpg") as ImageSourcePropType,
  },
  {
    id: "julie",
    name: "Julie",
    voice: "Zephyr",
    voiceLabel: "Bright and clear",
    style: "Bright and encouraging — what worked, then what's next.",
    portrait: require("../../../assets/coaches/julie.jpg") as ImageSourcePropType,
  },
];

export const DEFAULT_COACH_ID: CoachId = "mark";

export function isCoachId(v: unknown): v is CoachId {
  return COACHES.some((c) => c.id === v);
}

/** The roster entry for an id, falling back to the default so a stale stored id can't blank the UI. */
export function coachById(id: CoachId | string): Coach {
  return COACHES.find((c) => c.id === id) ?? COACHES[0];
}
