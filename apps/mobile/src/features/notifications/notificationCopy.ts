import type { ComponentType } from "react";
import {
  Activity,
  Award,
  CheckCheck,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  CornerUpLeft,
  CreditCard,
  Eye,
  Film,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  PenLine,
  Reply,
  Target,
  TrendingDown,
  TriangleAlert,
  Trophy,
  UserPlus,
  Video,
} from "lucide-react-native";
import type { Notification } from "@swingsage/schema/contract";

/**
 * How a notification reads on screen: its glyph, its tint, its age, and — for a grouped row —
 * what the fold actually contains.
 *
 * Pure on purpose. Everything here is the part of the inbox that can be wrong in a way no
 * screenshot catches (an age that says "yesterday" at four hours, a plural that reads "1
 * messages", a kind added to the enum that silently renders as nothing), so it is separated
 * from the components and tested directly.
 *
 * The server sends the title and body already written — this module never invents copy for a
 * row. What it adds is the presentation the wire format has no opinion about.
 */

/**
 * The tints, as theme token NAMES rather than colours: the icon is drawn by a component that
 * has the theme, and a colour resolved here would be the light theme's forever.
 *
 * Four tones, and each one earns its place by changing what a golfer does. `good` is an
 * arrival worth smiling at, `bad` is a setback or a refusal, `accent` is the coach acting on
 * you, `muted` is bookkeeping. Anything finer is decoration.
 */
export type NotificationTone = "accent" | "good" | "bad" | "muted";

/** The house icon shape (`ProfileScreen`'s `MenuRow`) — every glyph in the app is drawn this
 *  way, and typing it structurally keeps this module off lucide's internal types. */
export type GlyphComponent = ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

export interface NotificationLook {
  icon: GlyphComponent;
  tone: NotificationTone;
}

/**
 * Every §29 kind, exhaustively.
 *
 * `Record<Notification["kind"], …>` rather than a partial map with a fallback: adding a kind to
 * the contract enum (the taxonomy grows additively — D60 already grew it once) must be a
 * compile error HERE, not a row that renders with no glyph on somebody's phone. A default
 * branch would make that failure invisible, which is the whole reason this is typed this way.
 */
export const NOTIFICATION_LOOK: Record<Notification["kind"], NotificationLook> = {
  // Golfer — the swing itself
  analysis_ready: { icon: Activity, tone: "accent" },
  // `bad`, not `muted`: an analysis that did not finish is a setback the golfer may want to act
  // on, and bookkeeping tone would bury it under the rows that need nothing from them.
  analysis_failed: { icon: TriangleAlert, tone: "bad" },
  swing_reviewed: { icon: ClipboardCheck, tone: "accent" },

  // Golfer — the coach relationship
  coach_request_approved: { icon: CircleCheck, tone: "good" },
  coach_request_declined: { icon: CircleX, tone: "bad" },
  coach_comment: { icon: MessageSquare, tone: "accent" },
  coach_annotation: { icon: PenLine, tone: "accent" },
  coach_message: { icon: MessageCircle, tone: "accent" },
  coach_plan: { icon: ClipboardCheck, tone: "accent" },
  lesson_sent: { icon: Video, tone: "accent" },
  conversation_reply: { icon: Reply, tone: "accent" },
  review_answered: { icon: MessageSquareText, tone: "accent" },

  // Golfer — goals and rewards
  goal_assigned: { icon: Target, tone: "accent" },
  goal_achieved: { icon: Trophy, tone: "good" },
  goal_regressed: { icon: TrendingDown, tone: "bad" },
  achievement_earned: { icon: Award, tone: "good" },

  // Golfer — account
  subscription_event: { icon: CreditCard, tone: "muted" },

  // Coach
  golfer_request: { icon: UserPlus, tone: "accent" },
  golfer_swing: { icon: Film, tone: "accent" },
  golfer_reply: { icon: CornerUpLeft, tone: "accent" },
  plan_progress: { icon: CheckCheck, tone: "good" },
  review_requested: { icon: ClipboardCheck, tone: "accent" },
  student_message: { icon: MessageCircle, tone: "accent" },
  lesson_viewed: { icon: Eye, tone: "muted" },
  drill_done: { icon: CheckCheck, tone: "muted" },
  student_goal_achieved: { icon: Trophy, tone: "good" },
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * How long ago, the way a person would say it.
 *
 * Deliberately NOT an absolute timestamp: a clock time is the standing example of a number
 * that goes on screen because we happen to have it. "3h" is what tells a golfer whether this
 * is still worth opening; "14:52" makes them do the subtraction.
 *
 * Coarsens as it ages — minutes, then hours, then "yesterday", then a date — because precision
 * about a week-old event is precision nobody asked for. `now` is a parameter so the boundaries
 * are testable without freezing the clock.
 */
export function relativeAge(createdAt: number, now: number): string {
  const delta = now - createdAt;
  // A row minted seconds ago can carry a createdAt marginally in the future — clock skew
  // between the phone and the server. "just now" is right for both sides of zero.
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 2 * DAY) return "yesterday";
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`;
  const d = new Date(createdAt);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * What a folded row contains — D60's collapsing conversations, said out loud.
 *
 * A grouped row is one row on purpose (the server folded it), so the count is the only way the
 * golfer knows five messages arrived rather than one. Returns null at `count <= 1`, which is
 * every ungrouped row: "1 message" is a label that adds nothing and costs a line.
 */
export function foldLabel(kind: Notification["kind"], count: number): string | null {
  if (count <= 1) return null;
  const noun = FOLD_NOUN[kind] ?? "updates";
  return `${count} ${noun}`;
}

/**
 * The plural noun a fold counts. Partial by design — unlike the look map, a kind with no entry
 * has a truthful fallback ("updates") rather than a missing glyph, and most kinds never group
 * at all because they carry no `groupKey`.
 */
const FOLD_NOUN: Partial<Record<Notification["kind"], string>> = {
  coach_message: "messages",
  student_message: "messages",
  conversation_reply: "replies",
  golfer_reply: "replies",
  coach_comment: "comments",
  coach_annotation: "annotations",
  analysis_ready: "swings analysed",
  analysis_failed: "swings that didn't analyse",
  golfer_swing: "new swings",
  drill_done: "drills done",
  lesson_viewed: "lesson views",
  lesson_sent: "lessons",
  review_requested: "review requests",
};
