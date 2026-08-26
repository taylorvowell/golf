import type {
  AnalyzedSwingCard,
  BroadcastRecord,
  Conversation,
  InstructorDrill,
  Listing,
  StudentDetail,
  StudentSummary,
  ThreadEntry,
  TriageItem,
} from "./types";

/**
 * The sample roster the whole mocked surface renders — one instructor, eight students chosen
 * so every state in §4a has a face: an unread-heavy regular, a regressing student, one gone
 * quiet, a fresh pending request, an unanswered invite, a declined request, a frozen (ended)
 * relationship, and a blocked one. Deleting this file must break compilation, never blank a
 * screen — that is the mocked-not-plumbed guarantee.
 */

export const SAMPLE_GROUPS = ["Tuesday juniors", "Elite squad", "New students"] as const;

export const SAMPLE_STUDENTS: StudentSummary[] = [
  {
    id: "s-marcus",
    name: "Marcus Hale",
    initials: "MH",
    handicapLabel: "11–15",
    lastSwingAgo: "2h ago",
    trend: { label: "Tempo steadying", direction: "up" },
    compliance: { pct: 82, selfReportedOnly: false },
    unread: 2,
    lessonState: "viewed",
    groups: ["Elite squad"],
    state: "approved",
  },
  {
    id: "s-priya",
    name: "Priya Natarajan",
    initials: "PN",
    handicapLabel: "6–10",
    lastSwingAgo: "Yesterday",
    trend: { label: "Early extension up", direction: "down" },
    compliance: { pct: 64, selfReportedOnly: false },
    unread: 0,
    lessonState: "delivered",
    groups: ["Elite squad"],
    state: "approved",
  },
  {
    id: "s-jordan",
    name: "Jordan Blake",
    initials: "JB",
    handicapLabel: "21–28",
    lastSwingAgo: "9d ago",
    trend: { label: "No recent swings", direction: "flat" },
    compliance: { pct: 20, selfReportedOnly: true },
    unread: 0,
    lessonState: null,
    groups: ["Tuesday juniors"],
    state: "approved",
  },
  {
    id: "s-elena",
    name: "Elena Sokolova",
    initials: "ES",
    handicapLabel: "Scratch–5",
    lastSwingAgo: "4h ago",
    trend: { label: "Lead knee flex holding", direction: "up" },
    compliance: { pct: 95, selfReportedOnly: false },
    unread: 1,
    lessonState: "viewed",
    groups: ["Elite squad"],
    state: "approved",
  },
  {
    id: "s-tomas",
    name: "Tomás Rivera",
    initials: "TR",
    handicapLabel: "16–20",
    lastSwingAgo: "3d ago",
    trend: { label: "New this month", direction: "flat" },
    compliance: null,
    unread: 0,
    lessonState: null,
    groups: ["New students"],
    state: "pending",
  },
  {
    id: "s-ava",
    name: "Ava Chen",
    initials: "AC",
    handicapLabel: "—",
    lastSwingAgo: "—",
    trend: { label: "Invite sent", direction: "flat" },
    compliance: null,
    unread: 0,
    lessonState: null,
    groups: ["New students"],
    state: "invited",
  },
  {
    id: "s-declined",
    name: "Sam Whitfield",
    initials: "SW",
    handicapLabel: "—",
    lastSwingAgo: "—",
    trend: { label: "Request declined", direction: "flat" },
    compliance: null,
    unread: 0,
    lessonState: null,
    groups: [],
    state: "declined",
  },
  {
    id: "s-frozen",
    name: "Ray Okafor",
    initials: "RO",
    handicapLabel: "11–15",
    lastSwingAgo: "Jun 2026",
    trend: { label: "Relationship ended", direction: "flat" },
    compliance: null,
    unread: 0,
    lessonState: null,
    groups: [],
    state: "frozen",
  },
];

export const SAMPLE_TRIAGE: TriageItem[] = [
  {
    id: "t-1",
    kind: "review_request",
    studentId: "s-marcus",
    studentName: "Marcus Hale",
    initials: "MH",
    title: "Asked you to review a swing",
    detail: "7 iron · analysed · “still coming over the top?”",
    ageLabel: "2h",
  },
  {
    id: "t-2",
    kind: "regression",
    studentId: "s-priya",
    studentName: "Priya Natarajan",
    initials: "PN",
    title: "Early extension regressed",
    detail: "Worse in 4 of her last 5 analysed swings",
    ageLabel: "1d",
  },
  {
    id: "t-3",
    kind: "compliance",
    studentId: "s-jordan",
    studentName: "Jordan Blake",
    initials: "JB",
    title: "Drills going undone",
    detail: "1 of 5 assigned reps this week — self-reported only",
    ageLabel: "2d",
  },
  {
    id: "t-4",
    kind: "quiet",
    studentId: "s-jordan",
    studentName: "Jordan Blake",
    initials: "JB",
    title: "Gone quiet",
    detail: "No swings in 9 days — longest gap since joining",
    ageLabel: "2d",
  },
  {
    id: "t-5",
    kind: "goal",
    studentId: "s-elena",
    studentName: "Elena Sokolova",
    initials: "ES",
    title: "Achieved the focus you assigned",
    detail: "Steadier posture — clean in 8 of her last 10",
    ageLabel: "3d",
  },
];

export const SAMPLE_SWING_FEED: AnalyzedSwingCard[] = [
  { id: "sw-1", studentId: "s-marcus", studentName: "Marcus Hale", initials: "MH", club: "7 iron", score: 74, lowConfidence: false, ageLabel: "2h" },
  { id: "sw-2", studentId: "s-elena", studentName: "Elena Sokolova", initials: "ES", club: "Driver", score: 81, lowConfidence: false, ageLabel: "4h" },
  { id: "sw-3", studentId: "s-priya", studentName: "Priya Natarajan", initials: "PN", club: "6 iron", score: 68, lowConfidence: true, ageLabel: "1d" },
  { id: "sw-4", studentId: "s-marcus", studentName: "Marcus Hale", initials: "MH", club: "Driver", score: 77, lowConfidence: false, ageLabel: "1d" },
];

const MARCUS_THREAD: ThreadEntry[] = [
  {
    id: "e-1",
    from: "student",
    kind: "review_request",
    ageLabel: "2h",
    title: "Review request",
    body: "7 iron from this morning — still coming over the top?",
  },
  {
    id: "e-2",
    from: "instructor",
    kind: "lesson",
    ageLabel: "3d",
    title: "Video lesson · 4:32",
    body: "Transition tempo — watch the first move down.",
  },
  {
    id: "e-3",
    from: "instructor",
    kind: "drill_assignment",
    ageLabel: "3d",
    title: "Assigned: Pump drill",
    body: "3 sets of 10 before your next range session.",
  },
  {
    id: "e-4",
    from: "student",
    kind: "message",
    ageLabel: "2d",
    title: null,
    body: "That clicked — the pause at the top makes the difference.",
  },
  {
    id: "e-5",
    from: "instructor",
    kind: "message",
    ageLabel: "1d",
    title: null,
    body: "Range closed for the storm Thursday — sessions move to Friday.",
    fromBroadcast: true,
  },
  {
    id: "e-6",
    from: "instructor",
    kind: "plan_update",
    ageLabel: "1d",
    title: "Plan updated",
    body: "Added milestone: neutral path by end of month.",
  },
];

export const SAMPLE_CONVERSATIONS: Conversation[] = [
  {
    studentId: "s-marcus",
    studentName: "Marcus Hale",
    initials: "MH",
    unread: 2,
    lastPreview: "Plan updated",
    lastAgo: "1d",
    state: "active",
    entries: MARCUS_THREAD,
  },
  {
    studentId: "s-elena",
    studentName: "Elena Sokolova",
    initials: "ES",
    unread: 1,
    lastPreview: "Thank you — see you Tuesday!",
    lastAgo: "4h",
    state: "active",
    entries: [
      {
        id: "e-e1",
        from: "instructor",
        kind: "feedback",
        ageLabel: "5h",
        title: "On your driver swing",
        body: "Best move through the ball I've seen from you — hold that finish.",
      },
      {
        id: "e-e2",
        from: "student",
        kind: "message",
        ageLabel: "4h",
        title: null,
        body: "Thank you — see you Tuesday!",
      },
    ],
  },
  {
    studentId: "s-jordan",
    studentName: "Jordan Blake",
    initials: "JB",
    unread: 0,
    lastPreview: "Range closed for the storm Thursday…",
    lastAgo: "1d",
    state: "active",
    entries: [
      {
        id: "e-j1",
        from: "instructor",
        kind: "message",
        ageLabel: "1d",
        title: null,
        body: "Range closed for the storm Thursday — sessions move to Friday.",
        fromBroadcast: true,
      },
    ],
  },
  {
    studentId: "s-frozen",
    studentName: "Ray Okafor",
    initials: "RO",
    unread: 0,
    lastPreview: "Relationship ended · read-only",
    lastAgo: "Jun",
    state: "frozen",
    entries: [
      {
        id: "e-r1",
        from: "instructor",
        kind: "message",
        ageLabel: "Jun",
        title: null,
        body: "Good luck at the club championship, Ray.",
      },
    ],
  },
];

export const SAMPLE_BROADCASTS: BroadcastRecord[] = [
  {
    id: "b-1",
    sentAgo: "1d",
    audience: "All students",
    text: "Range closed for the storm Thursday — sessions move to Friday.",
    recipients: 4,
    replies: 2,
  },
  {
    id: "b-2",
    sentAgo: "2w",
    audience: "Tuesday juniors",
    text: "Bring your 7 iron this week — we're doing tempo work.",
    recipients: 1,
    replies: 0,
  },
];

export const SAMPLE_DRILLS: InstructorDrill[] = [
  { id: "d-1", name: "Pump drill", cues: "Pause at the top, half-way down, hold", equipment: null, hasDemo: true, assignedTo: 3 },
  { id: "d-2", name: "Towel under arms", cues: "Connection through the takeaway", equipment: "Towel", hasDemo: true, assignedTo: 2 },
  { id: "d-3", name: "Feet-together swings", cues: "Balance first, speed later", equipment: null, hasDemo: false, assignedTo: 1 },
  { id: "d-4", name: "Gate putting", cues: "Start line through the tees", equipment: "Two tees", hasDemo: false, assignedTo: 0 },
];

export const SAMPLE_LISTING: Listing = {
  name: "Michael Kent, PGA",
  credentials: "PGA Class A · TPI Level 2",
  experience: "14 years teaching",
  bio: "Full-swing rebuilds and honest short-game work. I teach the golfer in front of me, not a model swing.",
  specialties: ["Full swing", "Driver distance", "Course strategy"],
  coachingStyle: "Direct, drills-first",
  skillLevels: ["Beginner", "Intermediate", "Advanced"],
  delivery: "In person & remote",
  location: "Austin, TX",
  lifecycle: "listed",
  verified: true,
};

export function sampleStudentDetail(studentId: string): StudentDetail {
  const summary = SAMPLE_STUDENTS.find((s) => s.id === studentId) ?? SAMPLE_STUDENTS[0];
  return {
    summary,
    profile: {
      handedness: "Right-handed",
      age: "30–39",
      goals: ["More distance off the tee", "Break 85"],
      equipment: ["Driver 10.5°", "Irons 5–PW", "60° wedge"],
    },
    plan:
      summary.id === "s-marcus"
        ? {
            name: "Neutral path by September",
            milestonesDone: 2,
            milestones: 4,
            frequency: "3 range sessions a week",
            progressPct: 55,
          }
        : null,
    progress: [
      { metric: "Tempo ratio", series: [2.4, 2.6, 2.7, 2.9, 3.0], deltaLabel: "+0.6 this month", direction: "up" },
      { metric: "Early extension", series: [6, 5, 5, 4, 3], deltaLabel: "−3° this month", direction: "up" },
    ],
    swings: SAMPLE_SWING_FEED.filter((s) => s.studentId === summary.id).length
      ? SAMPLE_SWING_FEED.filter((s) => s.studentId === summary.id)
      : SAMPLE_SWING_FEED.slice(0, 2),
    drills: [
      { drillId: "d-1", name: "Pump drill", compliancePct: 80, checkedReps: 24, selfReportedDone: 6 },
      { drillId: "d-2", name: "Towel under arms", compliancePct: 40, checkedReps: 0, selfReportedDone: 4 },
    ],
    focusSlots: [
      { name: "Steadier posture", assignedBy: "you", progressLabel: "Clean in 6 of last 10" },
      { name: "Tempo 3:1", assignedBy: "ai", progressLabel: "Proposed last week" },
    ],
    privateNotes: [
      "Tends to over-rotate when tired — watch late-session swings.",
      "Prefers feel cues over positions.",
    ],
  };
}
