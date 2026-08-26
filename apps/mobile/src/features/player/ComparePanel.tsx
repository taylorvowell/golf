import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import type { SwingSummary } from "@swingsage/schema/contract";

import { DECK } from "../../design/deck";
import { useAuthenticatedImage } from "../../platform/useAuthenticatedImage";
import { COLORS } from "../../theme";
import { useSwings } from "../swings/useSwings";
import { anchorsOf, type Anchor } from "./align";
import { type PhaseBand } from "./phaseBands";
import { useSyncProfile } from "./useSyncProfile";
import { SwingLoader } from "../../design/system/SwingLoader";

/**
 * Put this swing next to another one.
 *
 * ## What it compares, and what it deliberately does not
 *
 * **Timing and scores, not geometry.** Two swings filmed on two days from two distances have
 * normalized coordinates that mean different things, so drawing one golfer's trace over another's
 * would be a picture the pipeline cannot justify — the project's own rule against fabricating a
 * measurement, applied to a comparison. What *is* comparable without any alignment at all is how
 * long each phase took, and that is the thing golfers already talk about: a 3:1 backswing to
 * downswing ratio is the single most quoted number in the sport.
 *
 * Durations are shown in **seconds first, frames second**. The two clips can be different frame
 * rates, and "24 frames vs 31 frames" is meaningless across 60fps and 120fps while "0.40s vs
 * 0.52s" is exact.
 *
 * ## Where the pros come from
 *
 * A reference swing is one carrying `referenceLabel` — the same flag the analyzer and the swing log
 * already use. There is no separate pro library and no seeded catalogue, so this list is honest
 * about being whatever reference swings actually exist. When none do, it says so instead of
 * showing an empty tab that looks broken.
 */

export interface ComparePanelProps {
  /** The swing being watched — excluded from the list, and the left-hand column. */
  swingId: string;
  fps: number;
  frameCount: number;
  bands: readonly PhaseBand[];
  score: number | null;
  tempoRatio: number | null;
  /** The chosen reference, held by the player so the picture can show it too. */
  reference: SwingSummary | null;
  onReference: (swing: SwingSummary | null) => void;
  /** Leave the comparison altogether — clears the reference AND puts the sheet away. */
  onExit: () => void;
}

type Tab = "reference" | "mine";

export function ComparePanel({
  swingId,
  fps,
  frameCount,
  bands,
  score,
  tempoRatio,
  reference,
  onReference,
  onExit,
}: ComparePanelProps) {
  const { state } = useSwings();
  const [tab, setTab] = useState<Tab>("reference");

  const { pros, mine } = useMemo(() => {
    const swings: SwingSummary[] = state.kind === "ok" ? state.swings : [];
    const others = swings.filter((s) => s.id !== swingId);
    return {
      pros: others.filter((s) => s.referenceLabel),
      mine: others.filter((s) => !s.referenceLabel),
    };
  }, [state, swingId]);

  if (reference) {
    return (
      <Comparison
        swingId={swingId}
        fps={fps}
        frameCount={frameCount}
        bands={bands}
        score={score}
        tempoRatio={tempoRatio}
        reference={reference}
        onChange={() => onReference(null)}
        onStop={onExit}
      />
    );
  }

  const list = tab === "reference" ? pros : mine;

  return (
    <View style={styles.wrap} testID="compare-panel">
      <View style={styles.tabs}>
        <Tab2 label="Reference swings" count={pros.length} on={tab === "reference"} onPress={() => setTab("reference")} />
        <Tab2 label="My swings" count={mine.length} on={tab === "mine"} onPress={() => setTab("mine")} />
      </View>

      {state.kind === "loading" ? (
        <SwingLoader size={48} ground="dark" style={styles.spinner} />
      ) : list.length === 0 ? (
        <Text style={styles.empty}>
          {tab === "reference"
            ? "No reference swings yet. A swing becomes one when it is given a reference label — there is no separate library of pros."
            : "This is your only swing so far. Record another and they can be put side by side."}
        </Text>
      ) : (
        <View style={styles.list}>
          {list.map((s) => (
            <SwingRow key={s.id} swing={s} onPress={() => onReference(s)} />
          ))}
        </View>
      )}
    </View>
  );
}

function Tab2({
  label,
  count,
  on,
  onPress,
}: {
  label: string;
  count: number;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      style={[styles.tab, on && styles.tabOn]}
    >
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
      <Text style={[styles.tabCount, on && styles.tabCountOn]}>{count}</Text>
    </Pressable>
  );
}

function SwingRow({ swing, onPress }: { swing: SwingSummary; onPress: () => void }) {
  // `?poster=1` = one frame, not the 6×4 contact sheet — a grid at card size reads as noise.
  const thumb = useAuthenticatedImage(`swings/${swing.id}/thumb?poster=1`);
  const scored = typeof swing.overallScore === "number";

  return (
    <Pressable
      testID={`compare-pick-${swing.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Compare with ${swing.label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.thumbWrap}>
        {thumb ? (
          <Image source={thumb} style={styles.thumb} contentFit="cover" cachePolicy="disk" transition={120} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={styles.rowLabel}>
          {swing.referenceLabel ?? swing.label}
        </Text>
        <Text style={styles.rowMeta}>
          {formatDate(swing.createdAt)}
          {swing.tempoRatio ? ` · tempo ${swing.tempoRatio.toFixed(1)}:1` : ""}
        </Text>
      </View>
      {/* An unscored swing shows no score. Rendering `null` as `0` invents a fact. */}
      <Text style={[styles.rowScore, !scored && styles.rowUnscored]}>
        {scored ? Math.round(swing.overallScore as number) : "—"}
      </Text>
    </Pressable>
  );
}

/** The two swings, side by side, on the numbers that survive being compared across two clips. */
function Comparison({
  fps,
  bands,
  score,
  tempoRatio,
  reference,
  onChange,
  onStop,
}: Omit<ComparePanelProps, "reference" | "onReference" | "onExit"> & {
  /** Non-null here by construction — the picker is what is shown until one is chosen. */
  reference: SwingSummary;
  onChange: () => void;
  onStop: () => void;
}) {
  // The projection, not the artifact: this panel needs four frame numbers, and reading them out of
  // `analysis.json` cost 22 MB on `pro_3` — a second full download beside the pane's own.
  const state = useSyncProfile(reference.id);
  const anchors = useMemo(
    () => (state.kind === "ok" ? anchorsOf(state.profile) : null),
    [state],
  );
  const refFps = state.kind === "ok" && state.profile.fps > 0 ? state.profile.fps : reference.fps;

  return (
    <View style={styles.wrap} testID="compare-result">
      <View style={styles.versus}>
        <Text style={styles.versusName} numberOfLines={1}>
          This swing
        </Text>
        <Text style={styles.versusVs}>vs</Text>
        <Text style={styles.versusName} numberOfLines={1}>
          {reference.referenceLabel ?? reference.label}
        </Text>
      </View>

      <CompareRow
        label="Score"
        left={typeof score === "number" ? String(Math.round(score)) : "not scored"}
        right={
          typeof reference.overallScore === "number"
            ? String(Math.round(reference.overallScore))
            : "not scored"
        }
      />
      <CompareRow
        label="Tempo"
        left={tempoRatio ? `${tempoRatio.toFixed(1)} : 1` : "—"}
        right={reference.tempoRatio ? `${reference.tempoRatio.toFixed(1)} : 1` : "—"}
      />

      {state.kind === "loading" ? (
        <SwingLoader size={48} ground="dark" style={styles.spinner} />
      ) : !anchors ? (
        <Text style={styles.empty}>
          That swing has no positions the analyzer stands behind, so its phases cannot be timed. The
          score and tempo above are all it can be compared on.
        </Text>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Phase timing</Text>
          {PHASES.map(({ key, label, from, to }) => (
            <CompareRow
              key={key}
              label={label}
              left={duration(bands, key, fps)}
              // An em dash where a position was not admitted: quoting a backswing measured to a
              // frame the analyzer nudged into place would be a number with nothing behind it.
              right={spanSeconds(anchors, from, to, refFps)}
            />
          ))}
          {/* Seconds, not frames, because the two clips can be different rates — and "24 frames vs
              31" is meaningless across 60fps and 120fps. */}
          <Text style={styles.footnote}>
            Timed in seconds because the two clips need not share a frame rate.
          </Text>
        </>
      )}

      <Pressable
        testID="compare-change"
        accessibilityRole="button"
        accessibilityLabel="Choose a different swing"
        onPress={onChange}
        style={({ pressed }) => [styles.changeButton, pressed && styles.rowPressed]}
      >
        <Text style={styles.changeText}>Compare with something else</Text>
      </Pressable>
      {/* The way out. Without it the only exit from a comparison is the orb that opened it, which
          reads as a toggle nobody can find once the sheet is up. */}
      <Pressable
        testID="compare-stop"
        accessibilityRole="button"
        accessibilityLabel="Stop comparing"
        onPress={onStop}
        style={({ pressed }) => [styles.stopButton, pressed && styles.rowPressed]}
      >
        <Text style={styles.stopText}>Stop comparing</Text>
      </Pressable>
    </View>
  );
}

/**
 * The three phases, as the two positions that bound each.
 *
 * P1→P4→P7→P10 is the same partition the leader's bands draw, expressed in the vocabulary both
 * swings share. It is what makes the two columns comparable at all: the leader's are measured from
 * its events (and any hand correction the golfer made), the reference's from its admitted anchors,
 * and the two agree on where a backswing starts and stops.
 */
const PHASES = [
  { key: "backswing" as const, label: "Backswing", from: "P1", to: "P4" },
  { key: "downswing" as const, label: "Downswing", from: "P4", to: "P7" },
  { key: "through" as const, label: "Through", from: "P7", to: "P10" },
];

function spanSeconds(anchors: Anchor[], from: string, to: string, fps: number): string {
  const a = anchors.find((x) => x.p === from);
  const b = anchors.find((x) => x.p === to);
  if (!a || !b || fps <= 0 || b.frame <= a.frame) return "—";
  return `${((b.frame - a.frame) / fps).toFixed(2)}s`;
}

function CompareRow({ label, left, right }: { label: string; left: string; right: string }) {
  return (
    <View style={styles.compareRow}>
      <Text style={styles.compareValue}>{left}</Text>
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={[styles.compareValue, styles.compareRight]}>{right}</Text>
    </View>
  );
}

function duration(bands: readonly PhaseBand[], key: string, fps: number): string {
  const band = bands.find((b) => b.key === key);
  if (!band || fps <= 0) return "—";
  const frames = band.to - band.from;
  return `${(frames / fps).toFixed(2)}s`;
}

function formatDate(epoch: number): string {
  // `createdAt` is an integer in the contract. Seconds and milliseconds are both plausible and
  // silently differ by 50 years, so it is normalized rather than assumed.
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  spinner: { paddingVertical: 24 },
  empty: { color: COLORS.muted, fontSize: 12.5, lineHeight: 18 },

  tabs: { flexDirection: "row", gap: 6, padding: 4, borderRadius: 14, backgroundColor: DECK.glass.well },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 38,
    borderRadius: 11,
  },
  tabOn: { backgroundColor: "rgba(87,215,216,0.14)" },
  tabText: { color: "rgba(255,255,255,0.5)", fontSize: 12.5, fontWeight: "600" },
  tabTextOn: { color: DECK.accent },
  tabCount: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 10,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  tabCountOn: { color: DECK.accent },

  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 8,
    borderRadius: 14,
    backgroundColor: DECK.glass.key,
    minHeight: 64,
  },
  rowPressed: { opacity: 0.6 },
  thumbWrap: { width: 58, height: 46, borderRadius: 9, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  thumbEmpty: { backgroundColor: COLORS.border },
  rowBody: { flex: 1, gap: 3 },
  rowLabel: { color: COLORS.text, fontSize: 14, fontWeight: "600" },
  rowMeta: { color: COLORS.muted, fontSize: 11.5 },
  rowScore: { color: COLORS.text, fontSize: 20, fontWeight: "700", minWidth: 34, textAlign: "right" },
  rowUnscored: { color: COLORS.dim, fontSize: 14 },

  versus: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 4 },
  versusName: { flex: 1, color: COLORS.text, fontSize: 13.5, fontWeight: "700" },
  versusVs: { color: COLORS.dim, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  sectionTitle: {
    color: DECK.label.caption,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    paddingTop: 6,
  },
  compareRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
  },
  compareValue: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  compareRight: { textAlign: "right" },
  compareLabel: { color: COLORS.muted, fontSize: 11, textAlign: "center", minWidth: 84 },
  footnote: { color: COLORS.dim, fontSize: 10.5, lineHeight: 15 },

  changeButton: {
    marginTop: 6,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DECK.glass.key,
  },
  changeText: { color: COLORS.text, fontSize: 13, fontWeight: "600" },
  stopButton: { height: 42, alignItems: "center", justifyContent: "center" },
  stopText: { color: COLORS.muted, fontSize: 12.5, fontWeight: "600" },
});
