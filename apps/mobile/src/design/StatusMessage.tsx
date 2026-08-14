import { Pressable, Text, View } from "react-native";

import { themedStyles } from "../theme";

/**
 * A centred full-area status — the expired-session and cannot-reach states, shared by Home and
 * the swing log so the two screens cannot drift into wording the same failure differently.
 * The retry button is part of the contract: a state a golfer can do nothing about is a state
 * this component must not be used for.
 */
export function StatusMessage({
  title,
  detail,
  onRetry,
  retryTestID = "status-retry",
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  retryTestID?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.centre}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        testID={retryTestID}
        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
      >
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: { color: t.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: {
    color: t.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
  retry: {
    marginTop: 6,
    backgroundColor: t.panel,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
  retryText: { color: t.text, fontSize: 13, fontWeight: "700" },
}));
