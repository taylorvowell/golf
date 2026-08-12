import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { UpgradeRequired } from "@swingsage/schema/contract";

import { COLORS } from "../theme";

export interface UpgradeRequiredScreenProps {
  detail: UpgradeRequired;
  /** Injected in tests; defaults to the platform's own store handler. */
  onOpenStore?: (url: string) => void;
}

/**
 * What a build too old to be served shows instead of a failed request.
 *
 * This screen is the entire reason the 426 exists. Without it an unsupported build shows a
 * spinner, a generic network error, or an empty list — all of which read as "SwingSage is
 * broken", and none of which a golfer can act on. The one thing they can do is update, so that
 * is the only thing on screen.
 *
 * Deliberately terminal: no retry, no dismiss. Retrying cannot succeed, and a dismissable
 * blocker is one a user learns to dismiss.
 */
export default function UpgradeRequiredScreen({
  detail,
  onOpenStore,
}: UpgradeRequiredScreenProps) {
  const open = onOpenStore ?? ((url: string) => void Linking.openURL(url));

  return (
    <View style={styles.root} testID="upgrade-required">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>UPDATE REQUIRED</Text>
        <Text style={styles.title}>SwingSage needs updating</Text>
        <Text style={styles.body}>
          {detail.message ??
            "This version is too old to read your swings safely. Your swings are all still here."}
        </Text>
        <Text style={styles.meta}>
          This build requires {detail.minimumVersion} or newer. The current release is{" "}
          {detail.currentVersion}.
        </Text>
        {detail.storeUrl ? (
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            testID="upgrade-open-store"
            onPress={() => open(detail.storeUrl as string)}
          >
            <Text style={styles.buttonText}>Update SwingSage</Text>
          </Pressable>
        ) : (
          // No store link is a server-side gap, not the golfer's problem — say what to do anyway
          // rather than showing a button that goes nowhere.
          <Text style={styles.meta} testID="upgrade-no-store">
            Update SwingSage from your device&apos;s app store to continue.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  eyebrow: { color: COLORS.amber, fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  title: { color: COLORS.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 },
  body: { color: COLORS.muted, fontSize: 15, lineHeight: 22 },
  meta: { color: COLORS.dim, fontSize: 13, lineHeight: 19 },
  button: {
    marginTop: 6,
    backgroundColor: COLORS.acid,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: COLORS.onAcid, fontSize: 15, fontWeight: "700" },
});
