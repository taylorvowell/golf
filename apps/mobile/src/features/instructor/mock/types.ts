/**
 * The instructor surface's VIEW-MODELS (architecture §4a) — the shapes the screens render and
 * the later tracks fill. These types ARE the swap seams' contracts: `instructor-relationships`
 * replaces the roster seam, `instructor-collaboration` the thread/broadcast seams,
 * `instructor-video-lessons` the lesson entries — each by re-implementing a `use*` hook in
 * `seams.ts` against real data, with the screens untouched. Nothing here reaches the network.
 */

/** §24.4's states plus the two thread states D60 adds and the declared `invited` addition. */
export type RelationshipState =
  | "approved"
  | "pending"
  | "invited"
  | "declined"
  | "frozen"
  | "blocked";

export type TrendDirection = "up" | "down" | "flat";

export interface StudentSummary {
  id: string;
  name: string;
  initials: string;
  handicapLabel: string;
  /** Human recency — "2h ago", "6d ago". Raw timestamps are diagnostics. */
  lastSwingAgo: string;
  /** One measured headline, already chosen server-side later — never a metrics dump. */
  trend: { label: string; direction: TrendDirection };
  /** Assigned-drill follow-through. Camera-verified and self-reported NEVER mingle (§18.5). */
  compliance: { pct: number; selfReportedOnly: boolean } | null;
  unread: number;
  /** D60 §1.3's roster signal — the reserved lesson slot. */
  lessonState: "delivered" | "viewed" | null;
  groups: string[];
  state: RelationshipState;
}

/** The triage queue — the separating surface. Sorted by what CHANGED, never upload order. */
export interface TriageItem {
  id: string;
  kind: "review_request" | "regression" | "quiet" | "compliance" | "goal";
  studentId: string;
  studentName: string;
  initials: string;
  title: string;
  detail: string;
  ageLabel: string;
}

export interface AnalyzedSwingCard {
  id: string;
  studentId: string;
  studentName: string;
  initials: string;
  club: string;
  /** Score + the honesty flag — low-confidence analysis renders dimmed, never as fact. */
  score: number;
  lowConfidence: boolean;
  ageLabel: string;
}

/** One entry in the D60 conversation feed — typed rich cards, never plain bubbles. */
export interface ThreadEntry {
  id: string;
  from: "instructor" | "student";
  kind:
    | "message"
    | "lesson"
    | "review_request"
    | "drill_assignment"
    | "plan_update"
    | "shared_swing"
    | "feedback";
  ageLabel: string;
  title: string | null;
  body: string;
  /** Set on entries fanned out by a broadcast — renders a quiet "sent to all" mark for the
   *  INSTRUCTOR only; the student's copy is indistinguishable from a personal message. */
  fromBroadcast?: boolean;
}

export interface Conversation {
  studentId: string;
  studentName: string;
  initials: string;
  unread: number;
  lastPreview: string;
  lastAgo: string;
  state: "active" | "frozen" | "blocked";
  entries: ThreadEntry[];
}

export interface BroadcastRecord {
  id: string;
  sentAgo: string;
  audience: string;
  text: string;
  recipients: number;
  replies: number;
}

export interface InstructorDrill {
  id: string;
  name: string;
  cues: string;
  equipment: string | null;
  hasDemo: boolean;
  assignedTo: number;
}

export type ListingLifecycle = "draft" | "pending" | "listed" | "rejected" | "suspended";

/** §23.1's full field set — the public face a golfer's directory renders. */
export interface Listing {
  name: string;
  credentials: string;
  experience: string;
  bio: string;
  specialties: string[];
  coachingStyle: string;
  skillLevels: string[];
  delivery: "In person" | "Remote" | "In person & remote";
  location: string;
  lifecycle: ListingLifecycle;
  verified: boolean;
}

export interface FocusSlot {
  name: string;
  assignedBy: "you" | "ai" | "self";
  progressLabel: string;
}

export interface StudentDetail {
  summary: StudentSummary;
  /** The shared §25.2 profile facts — public face + the six answers the link grants. */
  profile: { handedness: string; age: string; goals: string[]; equipment: string[] };
  /** §28's current plan — null renders the create door, never an empty card. */
  plan: {
    name: string;
    milestonesDone: number;
    milestones: number;
    frequency: string;
    progressPct: number;
  } | null;
  /** Measured trends — the documented-progress surface. Small, chosen, never a dump. */
  progress: { metric: string; series: number[]; deltaLabel: string; direction: TrendDirection }[];
  swings: AnalyzedSwingCard[];
  drills: {
    drillId: string;
    name: string;
    compliancePct: number;
    checkedReps: number;
    selfReportedDone: number;
  }[];
  /** The 3-slot rule made visible (§16.3.2). */
  focusSlots: FocusSlot[];
  privateNotes: string[];
}
