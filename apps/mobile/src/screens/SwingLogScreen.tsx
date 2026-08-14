import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMemo } from "react";

import { StatusMessage } from "../design/StatusMessage";
import { TopBar } from "../design/TopBar";
import { useAppNavigation } from "../navigation";
import { SessionCard } from "../features/swings/SessionCard";
import { sessionize } from "../features/swings/sessions";
import { useSwings } from "../features/swings/useSwings";
import { themedStyles, useTheme } from "../theme";

/**
 * §21's swing log — the golfer's home, grouped by practice **session**.
 *
 * Accordion sessions rather than a flat list of cards (Taylor, 2026-08-13): the thumbnails are
 * near-identical frames of the same person on the same mat, so the flat list made every swing
 * look the same. The row now leads with the number in the session, the score and the time —
 * "which one was the good one" answered at a glance. The newest session opens expanded.
 *
 * The one property that survives every rewrite of this screen: a request that never reached the
 * server renders as "cannot reach SwingSage", **never** as an empty log. That invariant has a
 * test, because the failure it prevents — telling someone their swings are gone when they are
 * not — is the only one here that costs trust rather than a tap.
 */
export function SwingLogScreen() {
  const navigation = useAppNavigation();
  const { state, refreshing, refresh } = useSwings();
  const sessions = useMemo(
    () => (state.kind === "ok" ? sessionize(state.swings) : []),
    [state],
  );
  // Edge-to-edge is on and the nav bar is transparent, so the list draws under it. The bottom
  // inset keeps the last card — and the Delete-account footer, the one irreversible control on
  // this screen — tappable above the system bar on 3-button navigation (~48dp).
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.root}>
      <TopBar title="Your swings" />
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

      {state.kind === "ok" ? (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={
            sessions.length
              ? [styles.list, { paddingBottom: 32 + insets.bottom }]
              : [styles.list, styles.listEmpty, { paddingBottom: 32 + insets.bottom }]
          }
          // Pull-to-refresh rather than a button: the list is the whole screen, and a refresh
          // control never blanks what is already drawn — which is why `refreshing` is separate
          // from the `loading` state above.
          refreshControl={
            <RefreshControl
              testID="swing-log-refresh"
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={t.muted}
              colors={[t.accent]}
            />
          }
          renderItem={({ item, index }) => (
            <SessionCard
              session={item}
              defaultExpanded={index === 0}
              onOpenSwing={(id) => navigation.navigate("SwingDetail", { id })}
            />
          )}
          ListHeaderComponent={
            // A way into the after-swing screen while nothing records yet: the capture flow will
            // navigate there itself, and this row leaves with it. Quiet on purpose — it is a door
            // for testing the interface, not a feature of the log.
            state.swings.length ? (
              <Pressable
                testID="open-after-swing"
                accessibilityRole="button"
                onPress={() =>
                  navigation.navigate("SwingDetail", { id: state.swings[0].id, afterSwing: true })
                }
                style={({ pressed }) => [styles.afterSwingLink, pressed && styles.pressed]}
              >
                <Text style={styles.afterSwingLinkText}>Preview the after-swing screen</Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.centre}>
              <Text style={styles.title}>No swings yet</Text>
              <Text style={styles.detail}>
                Recording and upload arrive with the capture release. Swings you add will appear
                here.
              </Text>
            </View>
          }
        />
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 10 },
  listEmpty: { flexGrow: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: { color: t.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: {
    color: t.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
  pressed: { opacity: 0.6 },
  afterSwingLink: {
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: t.panel,
    borderRadius: 12,
    marginBottom: 2,
  },
  afterSwingLinkText: { color: t.muted, fontSize: 13, fontWeight: "600" },
}));
