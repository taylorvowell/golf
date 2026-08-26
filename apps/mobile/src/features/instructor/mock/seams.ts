import {
  SAMPLE_BROADCASTS,
  SAMPLE_CONVERSATIONS,
  SAMPLE_DRILLS,
  SAMPLE_GROUPS,
  SAMPLE_LISTING,
  SAMPLE_STUDENTS,
  SAMPLE_SWING_FEED,
  SAMPLE_TRIAGE,
  sampleStudentDetail,
} from "./sampleData";
import { useInstructorMockState } from "./mockState";
import type {
  AnalyzedSwingCard,
  BroadcastRecord,
  Conversation,
  InstructorDrill,
  Listing,
  StudentDetail,
  StudentSummary,
  TriageItem,
} from "./types";

/**
 * THE SWAP SEAMS (architecture §4a). Every instructor screen renders from exactly one of
 * these hooks and nothing else — no screen constructs sample data inline, so replacing a hook
 * body with a real fetch converts a screen without touching it. The later owners, by name:
 * roster/detail → `instructor-relationships`; threads/broadcasts → `instructor-collaboration`;
 * drills → `drill-library`'s authorship dimension; listing → `instructor-relationships` +
 * `admin-surface`; triage/feed → the relationships track's server rollups.
 */

export function useRosterSeam(): {
  students: StudentSummary[];
  groups: readonly string[];
  pending: StudentSummary[];
} {
  const { rosterEmpty } = useInstructorMockState();
  if (rosterEmpty) return { students: [], groups: SAMPLE_GROUPS, pending: [] };
  return {
    students: SAMPLE_STUDENTS.filter((s) => s.state === "approved"),
    groups: SAMPLE_GROUPS,
    pending: SAMPLE_STUDENTS.filter((s) => s.state === "pending" || s.state === "invited"),
  };
}

export function useTriageSeam(): { items: TriageItem[]; feed: AnalyzedSwingCard[] } {
  const { rosterEmpty } = useInstructorMockState();
  if (rosterEmpty) return { items: [], feed: [] };
  return { items: SAMPLE_TRIAGE, feed: SAMPLE_SWING_FEED };
}

export function useStudentSeam(studentId: string): StudentDetail {
  const { focusSlotsFull } = useInstructorMockState();
  const detail = sampleStudentDetail(studentId);
  if (!focusSlotsFull) return detail;
  return {
    ...detail,
    focusSlots: [
      { name: "Steadier posture", assignedBy: "you", progressLabel: "Clean in 6 of last 10" },
      { name: "Tempo 3:1", assignedBy: "ai", progressLabel: "In progress" },
      { name: "Neutral grip", assignedBy: "self", progressLabel: "Self-set last week" },
    ],
  };
}

export function useThreadsSeam(): { conversations: Conversation[]; broadcasts: BroadcastRecord[] } {
  const { threadState } = useInstructorMockState();
  const conversations = SAMPLE_CONVERSATIONS.map((c, index) =>
    index === 0 ? { ...c, state: threadState } : c,
  );
  return { conversations, broadcasts: SAMPLE_BROADCASTS };
}

export function useConversationSeam(studentId: string): Conversation | null {
  const { conversations } = useThreadsSeam();
  return conversations.find((c) => c.studentId === studentId) ?? null;
}

export function useDrillsSeam(): InstructorDrill[] {
  return SAMPLE_DRILLS;
}

export function useListingSeam(): Listing {
  const { listingLifecycle } = useInstructorMockState();
  return { ...SAMPLE_LISTING, lifecycle: listingLifecycle };
}
