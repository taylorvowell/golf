import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Plus, Trash2, Upload, X, type LucideIcon } from "lucide-react-native";
import type { SwingSummary } from "@swingsage/schema/contract";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CountUp } from "../features/session/CountUp";
import { ChoiceSheet } from "../features/session/sheets/ChoiceSheet";
import { SessionArrivalCard } from "../features/session/SessionArrivalCard";
import { takeSessionArrival } from "../features/session/sessionArrival";

import {
  APP_HEADER_BAR,
  AppHeader,
  HeroBackdrop,
  ScoreRing,
  HERO_PARALLAX,
  HERO_SHEET_GAP,
  SheetOverBackdrop,
  useChromeScroll,
  WAVE_NAV_CLEARANCE,
} from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { StatusMessage } from "../design/StatusMessage";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { LatestSessionCard } from "../features/swings/LatestSessionCard";
import { SessionRow } from "../features/swings/SessionRow";
import { logStats, mergeByDay, sessionize, type SwingSession } from "../features/swings/sessions";
import { cancelImportForSwing, usePendingImports, type PendingImport } from "../features/swings/pendingImports";
import { useSessions } from "../features/swings/useSessions";
import { ImportSheet } from "../features/swings/ImportSheet";
import { useImportSwing } from "../features/swings/useImportSwing";
import { deleteSwing, refreshSwings, useSwings } from "../features/swings/useSwings";
import { SwingReview } from "../features/session/SwingReview";
import { useToast } from "../features/toast/ToastProvider";
import { useAppNavigation } from "../navigation";
import { FixedDarkTheme, themedStyles, useTheme } from "../theme";

/**
 * §21's swing log, built on the Ideal Swing hero-screen scaffold (`log-v2-*`): the
 * performance hero — the whole log's stat tiles and all-swings average — rides behind a
 * sheet carrying the LATEST session card and the older-session list. (Taylor 2026-08-17
 * declutter: the mockup's week strip and "This week" head row are gone — the session dates
 * below already tell the when.) Every value on screen is real.
 *
 * The invariant that survives every rewrite: a request that never reached the server renders
 * as "cannot reach SwingSage", **never** as an empty log — now inside the sheet, same test.
 */
export function SwingLogScreen() {
  const navigation = useAppNavigation();
  const { state, refreshing, refresh } = useSwings();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();
  const { onScroll: onChromeScroll, chromePx } = useChromeScroll();
  // Measured once the hero lays out; until then the previous hand-tuned height keeps the first
  // frame in the right place, so nothing jumps.
  const [heroHeight, setHeroHeight] = useState<number | null>(null);
  const backdropHeight =
    heroHeight === null ? 330 + insets.top : heroHeight + 74 + HERO_SHEET_GAP;

  const { sessions: sessionRows } = useSessions();
  const pending = usePendingImports();

  /**
   * The ids a pending run already stands for. Ingest mints the swing row BEFORE the bytes
   * move, so from the first second of an upload the server has a row for a swing the log is
   * also drawing a placeholder for — and a refresh mid-upload showed the same swing twice
   * (Taylor, 2026-08-23). The placeholder wins while it lives: it is the one with the
   * progress. It retires shortly after `done`, and the real row takes over.
   */
  const pendingSwingIds = useMemo(
    () => new Set(pending.map((run) => run.swingId).filter((id): id is string => !!id)),
    [pending],
  );

  // One card per DAY (Taylor, 2026-08-22): a golfer went to the range once on Saturday, however
  // many session rows the app minted while they were there.
  const real = useMemo(
    () => (state.kind === "ok"
      ? mergeByDay(sessionize(
          state.swings.filter((s) => !pendingSwingIds.has(s.id)),
          sessionRows,
        ))
      : []),
    [state, sessionRows, pendingSwingIds],
  );

  /**
   * Imports still on their way, folded into the log they are heading for (Taylor, 2026-08-22).
   *
   * The toast says an upload started; this is where it is GOING, and a golfer who taps Upload and
   * then looks at their log should see the swing arriving in the right session rather than an
   * unchanged screen. If the import minted a session that has no swings yet, that session is
   * synthesized here — an empty card whose only row is the one being analysed. It is a real row
   * on the server (`sessionForToday` created it and primed the cache), so this is showing
   * something that exists, not predicting one.
   */
  const sessions = useMemo(() => {
    if (pending.length === 0) return real;
    // A run whose session already has a card just rides that card. Only a session with NOTHING
    // in it yet needs one synthesized — and it is a real row on the server (`sessionForToday`
    // created it and primed the cache), so this shows something that exists rather than
    // predicting one.
    const covered = new Set(real.flatMap((s) => s.parts));
    const extra: SwingSession[] = [];
    const seen = new Set<string>();
    for (const run of pending) {
      if (covered.has(run.sessionId) || seen.has(run.sessionId)) continue;
      seen.add(run.sessionId);
      const row = sessionRows.find((r) => r.id === run.sessionId);
      extra.push({
        id: run.sessionId,
        start: run.startedAt,
        end: run.startedAt,
        swings: [],
        best: null,
        name: row?.name ?? null,
        sessionType: row?.sessionType ?? null,
        parts: [run.sessionId],
      });
    }
    if (extra.length === 0) return real;
    // Merged again so a brand-new session lands INSIDE today's card rather than beside it.
    return mergeByDay([...extra, ...real]);
  }, [pending, real, sessionRows]);

  /** The runs each CARD is carrying — matched on the card's parts, because a day's card stands
   *  for every session row recorded that day. */
  const pendingFor = useCallback(
    (session: SwingSession) => pending.filter((run) => session.parts.includes(run.sessionId)),
    [pending],
  );

  const older = sessions.slice(1);

  /**
   * The accordion. ONE session open at a time (Taylor, 2026-08-22), and any of them may be shut
   * — including the featured card, which used to be permanently open and was the one row a
   * golfer had to scroll past to reach their older sessions.
   *
   * `undefined` means "not chosen yet" and resolves to the newest session, so the log still
   * lands showing the most recent visit; `null` is the golfer having closed it, which is a
   * different state and must not spring back open on the next render.
   */
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const first = sessions[0]?.id ?? null;
  const openSession = openId === undefined ? first : openId;

  /**
   * Deleting a swing, hosted HERE rather than inside the card.
   *
   * The card raises a request and this screen owns the confirmation, the animation and the
   * network call, for one reason: a card that deletes its own last swing unmounts mid-request,
   * and the sheet asking about it goes with it. Holding the pending target on the screen means
   * the sheet outlives the row.
   *
   * **There is no session delete.** A session is an organizing layer over swings and means
   * nothing without any, so emptying one removes it — server-side, inside the last swing's own
   * delete (Taylor, 2026-08-22).
   */
  const [pendingSwing, setPendingSwing] = useState<{ swing: SwingSummary; number: number } | null>(
    null,
  );
  /**
   * The swing on its way out. It stays in the list, dimmed and collapsing, for the length of the
   * animation before the request is even sent — a row that vanished the instant the sheet closed
   * gave the golfer nothing to connect the confirmation to the thing that disappeared.
   */
  const [removingId, setRemovingId] = useState<string | null>(null);
  const toast = useToast();

  const confirmSwingDelete = useCallback(async () => {
    const target = pendingSwing;
    setPendingSwing(null);
    if (!target) return;
    setRemovingId(target.swing.id);
    // The request waits for the animation rather than racing it: on a fast connection the cache
    // update lands first and unmounts the row mid-fade, which is the flicker this exists to
    // avoid. The row is already gone from the screen by the time the server is asked.
    await new Promise((resolve) => setTimeout(resolve, REMOVE_MS));
    // A swing being deleted mid-import takes its placeholder with it. Otherwise the row keeps
    // saying "analyzing" over a session that now counts zero swings (Taylor, 2026-08-23) —
    // `done` and `failed` are the placeholder's only other exits, and a deletion is neither.
    cancelImportForSwing(target.swing.id);
    try {
      await deleteSwing(target.swing.id);
    } catch {
      toast({
        id: `swing-delete-failed-${target.swing.id}`,
        title: "That swing was not deleted",
        icon: Trash2,
        detail: "This device could not reach SwingSage. Nothing was removed.",
      });
    } finally {
      // Cleared either way: on success the row is already unmounted, and on failure it has to
      // come back rather than sit invisible in a list that still contains it.
      setRemovingId(null);
    }
  }, [pendingSwing, toast]);

  /**
   * A swing arriving OPENS the session it is arriving into (Taylor, 2026-08-22).
   *
   * Uploading a clip while a different day was expanded left the news three cards away and
   * collapsed — the golfer did the thing and the log showed them nothing. Keyed on the run's
   * own id through a seen-set, so this fires once per import and never on a stage tick; a card
   * that re-opened itself every few seconds could not be closed.
   */
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const run of pending) {
      if (announced.current.has(run.localId)) continue;
      announced.current.add(run.localId);
      const card = sessions.find((s) => s.parts.includes(run.sessionId));
      if (card) setOpenId(card.id);
    }
  }, [pending, sessions]);

  const toggleSession = useCallback(
    (id: string) => setOpenId((current) => ((current === undefined ? first : current) === id ? null : id)),
    [first],
  );

  /**
   * The import door. Past the picker an imported clip takes the exact path a recorded swing
   * takes — same ingest, same analyzer, same session — so there is no second kind of swing.
   */
  const importer = useImportSwing(sessionRows);
  // Counted from the CONFIRMED log, never the pending one: a swing that is still uploading has
  // no score, no duration and no guarantee of arriving, and a count that moved before it landed
  // would have to move back if it failed.
  const log = useMemo(() => logStats(real), [real]);

  // A session just ended (D61): play the arrival — a saving beat, then the card springs in
  // and the counts roll up. Consumed once from the staging seam; an ordinary visit has none.
  // UI phase: the counts and card are the arrival's own numbers layered over the real stats
  // until the session rows persist (session-mode step 05).
  const [arrival] = useState(takeSessionArrival);
  /**
   * The mode of the session just ended, onto the newest row.
   *
   * It is the ONE session whose mode is known — the golfer picked it minutes ago and it came
   * through the arrival seam. Every older session stays null rather than being assigned a
   * plausible default, which would be a made-up claim about their own practice.
   */
  const latest = useMemo(
    () =>
      sessions[0] && arrival
        ? { ...sessions[0], sessionType: arrival.sessionType }
        : sessions[0],
    [arrival, sessions],
  );
  const [arrivalPhase, setArrivalPhase] = useState<"saving" | "landed" | null>(
    arrival ? "saving" : null,
  );
  useEffect(() => {
    if (arrivalPhase !== "saving") return;
    const settle = setTimeout(() => setArrivalPhase("landed"), 1100);
    return () => clearTimeout(settle);
  }, [arrivalPhase]);
  const landed = arrivalPhase === "landed";
  const shownSessions = log.sessions + (landed ? 1 : 0);
  const shownSwings = log.swings + (landed && arrival ? arrival.swings : 0);

  /**
   * The hero's CONTENT, handed to `backdropChrome` rather than to the backdrop itself.
   *
   * The gradient is painted below the scroll view; anything the golfer taps has to be inside it
   * or the touch is swallowed. Record and Upload were rendered in the backdrop and were
   * therefore visible, pressable-looking and completely dead — see `SheetOverBackdrop`.
   */
  const heroContent = (
      <View
        style={[styles.heroContent, { paddingTop: insets.top + APP_HEADER_BAR }]}
        // The sheet's resting edge is derived from this, so the gap below the hero is the same
        // on every hero screen instead of falling out of a hand-tuned backdrop height.
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setHeroHeight((prev) => (prev === h ? prev : h));
        }}
      >
        {/* The brand + profile door live in the floating AppHeader above; the hero keeps
            the screen's own title and the log's two capture doors (Taylor 2026-08-20).
            They sit on the TITLE row rather than in the header because they belong to this
            screen, not to the app chrome — and because the log is where a golfer arrives
            holding clips they have not put anywhere yet. */}
        <View style={styles.heroTitleRow}>
          <Text style={styles.heroTitle}>Swings</Text>
          <View style={styles.heroActions}>
            <HeroAction
              testID="swing-log-record"
              label="Record"
              icon={Plus}
              onPress={() => navigation.navigate("Record")}
            />
            <HeroAction
              testID="swing-log-upload"
              label="Upload"
              icon={Upload}
              onPress={importer.begin}
            />
          </View>
        </View>
        {/* .log-v2-summary — the whole log's story (Taylor 2026-08-17): session + swing
            counts left, the all-swings average in the ring. The latest session's own numbers
            live in the card below; repeating them here was the repetition rule's case. */}
        {latest ? (
          <View style={styles.heroSummary}>
            {/* Counts as STAT TILES (Taylor 2026-08-17) — the number in a glass square with
                its label beneath, so the row reads as figures rather than a title. */}
            <View style={styles.statRow}>
              <View style={styles.statBox}>
                <CountUp value={shownSessions} style={styles.statValue} />
                <Text style={styles.statLabel}>
                  {shownSessions === 1 ? "session" : "sessions"}
                </Text>
              </View>
              <View style={styles.statBox}>
                <CountUp value={shownSwings} style={styles.statValue} />
                <Text style={styles.statLabel}>{shownSwings === 1 ? "swing" : "swings"}</Text>
              </View>
            </View>
            {log.avg !== null && <ScoreRing score={log.avg} label="Average" size={88} />}
          </View>
        ) : null}
        {/* .log-v2-track */}
        {log.avg != null && log.best != null && log.best > 0 ? (
          <View style={styles.heroTrack}>
            <View
              style={[
                styles.heroTrackFill,
                { width: `${Math.min(100, Math.round((log.avg / log.best) * 100))}%` },
              ]}
            />
          </View>
        ) : null}
      </View>
  );

  const hero = <HeroBackdrop overscan={HERO_PARALLAX.cap} />;

  return (
    <View style={{ flex: 1 }}>
    <SheetOverBackdrop
      testID="swing-log"
      backdrop={hero}
      backdropChrome={heroContent}
      backdropHeight={backdropHeight}
      parallax={HERO_PARALLAX}
      // 0 = the sheet rests at the backdrop's edge on first paint. The mockup's 170 rode the
      // card halfway up the hero, which read as the sheet covering the screen (Taylor 2026-08-17).
      initialOffset={0}
      overlap={74}
      onScrollY={onChromeScroll}
      refreshControl={
        <RefreshControl
          testID="swing-log-refresh"
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={t.muted}
          colors={[t.cobalt]}
        />
      }
    >
      <View style={[styles.sheetContent, { paddingBottom: 120 + WAVE_NAV_CLEARANCE + insets.bottom }]}>
        {state.kind === "loading" ? (
          <View style={styles.centre} testID="swing-log-loading">
            <ActivityIndicator color={t.muted} />
          </View>
        ) : null}

        {state.kind === "signed-out" ? (
          <StatusMessage
            title="Your session has expired"
            detail="Sign out and sign back in to continue."
            onRetry={refresh}
            retryTestID="swing-log-retry"
          />
        ) : null}

        {state.kind === "unreachable" ? (
          <StatusMessage
            title="Cannot reach SwingSage"
            detail="Your swings are safe — this device just could not connect. Check your network."
            onRetry={refresh}
            retryTestID="swing-log-retry"
          />
        ) : null}

        {/* The server ANSWERED, and the answer was a failure. Telling a golfer to check a
            network that is demonstrably working sends them to fix the one part that is not
            broken — and nothing they do can help, so the words say so plainly. */}
        {state.kind === "server-error" ? (
          <StatusMessage
            title="SwingSage is having a problem"
            detail="Your swings are safe. Something went wrong on our side — try again in a moment."
            onRetry={refresh}
            retryTestID="swing-log-retry"
          />
        ) : null}

        {state.kind === "ok" && arrivalPhase != null && arrival ? (
          <SessionArrivalCard
            phase={arrivalPhase}
            title={arrival.title}
            swings={arrival.swings}
          />
        ) : null}

        {state.kind === "ok" && sessions.length === 0 && arrivalPhase == null ? (
          <View style={styles.centre}>
            <Text style={styles.emptyTitle}>No swings yet</Text>
            <Text style={styles.emptyDetail}>
              Record a swing, or upload one you have already filmed — it will appear here once
              it has been analysed.
            </Text>
          </View>
        ) : null}

        {state.kind === "ok" && latest ? (
          <>
            <LatestSessionCard
              session={latest}
              open={openSession === latest.id}
              onToggle={() => toggleSession(latest.id)}
              onOpenSwing={(id) => navigation.navigate("SwingDetail", { id })}
              onDeleteSwing={(swing, number) => setPendingSwing({ swing, number })}
              pending={pendingFor(latest)}
              removingId={removingId}
            />
            {/* .log-v2-session-list — every row expands to the swings inside it. */}
            {older.length > 0 && (
              <View style={styles.olderList}>
                {older.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    open={openSession === session.id}
                    onToggle={() => toggleSession(session.id)}
                    onOpenSwing={(id) => navigation.navigate("SwingDetail", { id })}
                    onDeleteSwing={(swing, number) => setPendingSwing({ swing, number })}
                    pending={pendingFor(session)}
                    removingId={removingId}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}
      </View>
    </SheetOverBackdrop>

    <AppHeader
      hero
      chromePx={chromePx}
      bell={<NotificationBell hero onPress={() => navigation.navigate("Notifications")} />}
      onProfile={() => navigation.navigate("Profile")}
      profileTestID="swing-log-profile"
    />

    {/* Asked once per import, over the log rather than on a screen of its own — picking a clip
        and saying which way the camera pointed is one action, not a flow. */}
    <ImportSheet
      visible={importer.pending !== null}
      clip={importer.pending}
      onClose={importer.cancel}
      onConfirm={importer.confirm}
    />

    {/* The mark-impact pass, identical to a recorded take's: an import is a recording that
        happened somewhere else, and nothing uploads until the golfer has seen the window and
        said save. A full-screen Modal, deliberately: it is its own window ABOVE the tab shell,
        so the wave nav cannot float over the Save button — the in-tree overlay version lost
        that fight to the scroll-driven chrome (Taylor, 2026-08-23). Pinned dark like every
        video-facing surface. */}
    <Modal
      visible={importer.reviewing !== null}
      // NOT "fade": Android animates the WINDOW's alpha, so every pixel of the review —
      // filmstrip, picture, controls — goes semi-transparent together and the swing log
      // shows straight through it (Taylor, 2026-08-23). An instant swap also matches how
      // session mode enters its own review, which is in-tree and has no window to fade.
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={importer.discardReview}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]}>
        <FixedDarkTheme>
          {importer.reviewing ? (
            <SwingReview
              take={importer.reviewing.take}
              saving={importer.savingReview}
              onSave={importer.saveReview}
              onDelete={importer.discardReview}
              importMode
            />
          ) : null}
        </FixedDarkTheme>
      </View>
    </Modal>

    <ChoiceSheet
      visible={pendingSwing !== null}
      onClose={() => setPendingSwing(null)}
      testID="log-swing-delete-sheet"
      title={pendingSwing ? `Delete Swing ${pendingSwing.number}?` : "Delete this swing?"}
      subtitle="The video and its analysis go permanently."
      choices={[
        {
          key: "delete",
          icon: Trash2,
          title: "Delete this swing",
          detail: "The rest of the session stays.",
          tone: "danger",
          onPress: () => void confirmSwingDelete(),
        },
        {
          key: "cancel",
          icon: X,
          title: "Keep this swing",
          detail: "Nothing is deleted.",
          onPress: () => setPendingSwing(null),
        },
      ]}
    />
    </View>
  );
}

/**
 * A hero glass pill — the log's capture doors, in the stat tiles' white-10 glass so the title
 * row reads as one material. Icon AND word: two adjacent doors that both add a swing are only
 * distinguishable if each says which one it is, and a bare "+" beside a bare arrow does not.
 */
/**
 * The glyph metrics every hero action shares (Taylor, 2026-08-23): the icon is sized HERE, not
 * at the call site, because Record's plus and Upload's arrow were drawn at different sizes and
 * weights and the pair read as two different buttons sitting next to each other.
 */
const HERO_ICON = 14;
const HERO_ICON_STROKE = 2.4;

function HeroAction({
  icon: Icon,
  label,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles();
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.heroAction, pressed && styles.heroActionPressed]}
    >
      <Icon size={HERO_ICON} color={t.onDark} strokeWidth={HERO_ICON_STROKE} />
      <Text style={styles.heroActionLabel}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  heroContent: { paddingHorizontal: 18 },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  /* .log-v2-top h3 — 30 at Sora's -2% */
  heroTitle: {
    flexShrink: 1,
    minWidth: 0,
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 30,
    lineHeight: displayLine(30),
    letterSpacing: -0.6,
  },
  heroActions: { flexDirection: "row", gap: 7 },
  heroAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 31,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  heroActionPressed: { backgroundColor: "rgba(255,255,255,0.18)" },
  heroActionLabel: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    // Taller than the size on purpose — Android clips descenders to the line box (SessionNav).
    lineHeight: 14,
    letterSpacing: 0.1,
  },
  /* .log-v2-summary */
  heroSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 22,
  },
  statRow: { flex: 1, minWidth: 0, flexDirection: "row", gap: 10 },
  /* Hero glass square — the white-10 tile the mockup's hero chips use. */
  statBox: {
    minWidth: 68,
    height: 68,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  statValue: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 26,
    lineHeight: 27,
    letterSpacing: -0.52,
  },
  statLabel: {
    color: "rgba(180,235,238,1)",
    fontFamily: FONT_DISPLAY.black,
    fontSize: 7,
    letterSpacing: 0.84,
    textTransform: "uppercase",
  },
  /* .log-v2-track — fixed white-alpha on the hero, like the ScoreRing's track. */
  heroTrack: {
    height: 4,
    marginTop: 18,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  heroTrackFill: { height: "100%", backgroundColor: t.aqua },

  sheetContent: { paddingHorizontal: 16 },

  /* .log-v2-session rows */
  olderList: { marginTop: 14, gap: 10 },

  centre: { alignItems: "center", justifyContent: "center", gap: 10, padding: 24, minHeight: 260 },
  emptyTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 17,
    textAlign: "center",
  },
  emptyDetail: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    maxWidth: 300,
  },
}));

/**
 * How long a deleted row takes to leave — the veil (130) plus the slide (190) plus a beat.
 * Must not be SHORTER than `SwingTimelineList`'s own exit, or the cache update unmounts the row
 * mid-slide and the animation this waits for never finishes on screen.
 */
const REMOVE_MS = 360;
