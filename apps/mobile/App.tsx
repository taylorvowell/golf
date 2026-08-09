import { useEffect, useState } from "react";
import { Platform, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { PROBES, type Probe, type ProbeStatus } from "./src/spike/probes";

/**
 * SwingSage — spike harness (platform-foundation step 02).
 *
 * This is deliberately NOT the product. It exists to answer three questions on real hardware
 * before any feature is built on the framework choice recorded in DECISIONS D5, which is
 * explicitly provisional until this passes.
 *
 * The order matters. Step 01's research confirmed an iOS path for the per-frame overlay
 * callback (AVPlayerItemVideoOutput + CADisplayLink) and could NOT confirm the Android
 * equivalent — so the unconfirmed risk sits entirely on the device already available, and
 * OVERLAY SYNC is question 1. If it fails on Android, the other two never need measuring and
 * D5 reopens.
 */

const COLORS = {
  bg: "#080a0d",
  panel: "#12161c",
  border: "#232a33",
  text: "#f7f8f5",
  muted: "#7e8691",
  dim: "#5b636e",
  acid: "#a3e635",
  violet: "#6d59ff",
  amber: "#f59e0b",
};

function StatusChip({ status }: { status: ProbeStatus }) {
  const map: Record<ProbeStatus, { label: string; color: string }> = {
    pending: { label: "PENDING", color: COLORS.muted },
    "blocked-dev-build": { label: "NEEDS DEV BUILD", color: COLORS.amber },
    pass: { label: "PASS", color: COLORS.acid },
    fail: { label: "FAIL", color: "#e5484d" },
  };
  const { label, color } = map[status];
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

function ProbeCard({ probe }: { probe: Probe }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{probe.title}</Text>
        <StatusChip status={probe.status} />
      </View>
      <Text style={styles.question}>{probe.question}</Text>
      <Text style={styles.why}>{probe.why}</Text>
      <Text style={styles.detail}>Measures: {probe.measures}</Text>
    </View>
  );
}

/** Reads what is knowable without a native module — proves the toolchain reaches the device. */
function useDeviceFacts() {
  const { width, height, scale, fontScale } = useWindowDimensions();
  const [ticks, setTicks] = useState(0);
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    let frames = 0;
    let raf = 0;
    const started = Date.now();
    const loop = () => {
      frames += 1;
      const elapsed = Date.now() - started;
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed));
        setTicks((t) => t + 1);
        frames = 0;
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ticks]);

  return {
    platform: `${Platform.OS} ${String(Platform.Version)}`,
    screen: `${Math.round(width)}×${Math.round(height)} @${scale}x`,
    fontScale: fontScale.toFixed(2),
    uiFps: fps === null ? "measuring…" : `${fps} fps`,
  };
}

export default function App() {
  const facts = useDeviceFacts();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>SWINGSAGE · PLATFORM FOUNDATION</Text>
        <Text style={styles.h1}>Step 02 spike</Text>
        <Text style={styles.lede}>
          Not the product. Three questions that decide whether the framework choice holds —
          answered on real hardware, Android first.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Device</Text>
          <Row k="Platform" v={facts.platform} />
          <Row k="Screen" v={facts.screen} />
          <Row k="Font scale" v={facts.fontScale} />
          <Row k="UI frame rate" v={facts.uiFps} />
          <Text style={styles.detail}>
            UI frame rate is JS-driven rAF, not video or capture rate. It only shows the toolchain
            reaches this device — it is not one of the three measurements.
          </Text>
        </View>

        {PROBES.map((p) => (
          <ProbeCard key={p.id} probe={p} />
        ))}

        <Text style={styles.footer}>
          All three probes need a development build (Expo Go cannot host the native modules).
          See docs/RUNBOOK.md §6.
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowK}>{k}</Text>
      <Text style={styles.rowV}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: 20, paddingTop: 64, paddingBottom: 48, gap: 14 },
  eyebrow: { color: COLORS.acid, fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  h1: { color: COLORS.text, fontSize: 30, fontWeight: "700", marginTop: 6, letterSpacing: -0.5 },
  lede: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  card: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
  question: { color: COLORS.text, fontSize: 13, lineHeight: 19 },
  why: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  detail: { color: COLORS.dim, fontSize: 11, lineHeight: 17, fontStyle: "italic" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowK: { color: COLORS.muted, fontSize: 13 },
  rowV: { color: COLORS.text, fontSize: 13, fontWeight: "600" },
  footer: { color: COLORS.dim, fontSize: 11, lineHeight: 17, marginTop: 6 },
});
