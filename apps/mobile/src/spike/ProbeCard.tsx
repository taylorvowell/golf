import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import type { Probe, ProbeStatus } from "./probes";
import { COLORS, styles } from "./styles";

/**
 * Presentational half of the spike screen, split out from `SpikeScreen` for one reason: this file
 * imports nothing native, so it can actually be rendered in a test. `SpikeScreen` pulls in
 * `requireNativeView`, which throws outside a dev build.
 *
 * That matters more than tidiness here. The card is what a human reads to decide whether the
 * framework choice held, so "does it ever show PASS without a measurement" is a question worth
 * asserting in a test rather than trusting to review.
 */

const CHIP: Record<ProbeStatus, { label: string; color: string }> = {
  pending: { label: "NOT RUN", color: COLORS.muted },
  "blocked-dev-build": { label: "NEEDS CAMERA", color: COLORS.amber },
  running: { label: "RUNNING…", color: COLORS.violet },
  pass: { label: "PASS", color: COLORS.acid },
  fail: { label: "FAIL", color: COLORS.red },
};

export interface StatusChipProps {
  status: ProbeStatus;
}

export function StatusChip({ status }: StatusChipProps) {
  const { label, color } = CHIP[status];
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

export interface ProbeCardProps {
  probe: Probe;
  onRun?: () => void;
  disabled?: boolean;
  /** Extra controls a probe supplies itself, e.g. the camera preview for probe 3. */
  children?: ReactNode;
}

export function ProbeCard({ probe, onRun, disabled = false , children }: ProbeCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{probe.title}</Text>
        <StatusChip status={probe.status} />
      </View>
      <Text style={styles.question}>{probe.question}</Text>
      <Text style={styles.why}>{probe.why}</Text>
      <Text style={styles.detail}>Measures: {probe.measures}</Text>
      {probe.detail ? <Text style={styles.result}>{probe.detail}</Text> : null}
      {onRun ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Run probe: ${probe.title}`}
          onPress={onRun}
          disabled={disabled}
          style={({ pressed }) => [styles.button, (disabled || pressed) && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>
            {probe.status === "running" ? "Measuring…" : "Run probe"}
          </Text>
        </Pressable>
      ) : null}
      {children}
    </View>
  );
}
