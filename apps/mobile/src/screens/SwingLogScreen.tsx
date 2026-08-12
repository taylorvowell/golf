import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { AccountBar } from "../features/auth/AccountBar";
import { useAppNavigation } from "../navigation";
import { SwingCard } from "../features/swings/SwingCard";
import { useSwings } from "../features/swings/useSwings";
import { COLORS } from "../theme";

/**
 * §21's swing log — the golfer's home.
 *
 * This replaces the placeholder that showed a *count*. The one property carried over from it
 * unchanged is the refusal to guess: a request that never reached the server renders as "cannot
 * reach SwingSage", never as an empty log. That invariant has a test and it survives every rewrite
 * of this screen, because the failure it prevents — telling someone their swings are gone when
 * they are not — is the only one on this screen that costs trust rather than a tap.
 */
export function SwingLogScreen() {
  const navigation = useAppNavigation();
  const { state, refreshing, refresh } = useSwings();

  return (
    <View style={styles.root}>
      <AccountBar />
      {state.kind === "loading" ? (
        <View style={styles.centre} testID="swing-log-loading">
          <ActivityIndicator color={COLORS.muted} />
        </View>
      ) : null}

      {state.kind === "signed-out" ? (
        <Message
          title="Your session has expired"
          detail="Sign out and sign back in to continue."
          onRetry={refresh}
        />
      ) : null}

      {state.kind === "unreachable" ? (
        <Message
          title="Cannot reach SwingSage"
          detail="Your swings are safe — this device just could not connect. Check your network."
          onRetry={refresh}
        />
      ) : null}

      {state.kind === "ok" ? (
        <FlatList
          data={state.swings}
          keyExtractor={(s) => s.id}
          contentContainerStyle={
            state.swings.length ? styles.list : [styles.list, styles.listEmpty]
          }
          // Pull-to-refresh rather than a button: the list is the whole screen, and a refresh
          // control never blanks what is already drawn — which is why `refreshing` is separate
          // from the `loading` state above.
          refreshControl={
            <RefreshControl
              testID="swing-log-refresh"
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={COLORS.muted}
              colors={[COLORS.acid]}
            />
          }
          renderItem={({ item }) => (
            <SwingCard swing={item} onPress={() => navigation.navigate("SwingDetail", { id: item.id })} />
          )}
          ListEmptyComponent={
            <View style={styles.centre}>
              <Text style={styles.title}>No swings yet</Text>
              <Text style={styles.detail}>
                Recording and upload arrive with the capture release. Swings you add will appear
                here.
              </Text>
            </View>
          }
          ListFooterComponent={
            // §4.3 has to be reachable and `mobile-app-shell` step 02 owns the settings screen
            // this belongs on. Below the list, quiet, and past everything else on purpose: it is
            // the only irreversible action in the app.
            <Pressable
              onPress={() => navigation.navigate("DeleteAccount")}
              accessibilityRole="button"
              testID="open-delete-account"
              style={({ pressed }) => [styles.footer, pressed && styles.pressed]}
            >
              <Text style={styles.footerText}>Delete account</Text>
            </Pressable>
          }
        />
      ) : null}
    </View>
  );
}

function Message({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.centre}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        testID="swing-log-retry"
        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
      >
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 10 },
  listEmpty: { flexGrow: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  detail: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
  },
  retry: {
    marginTop: 6,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
  retryText: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  footer: { alignItems: "center", paddingVertical: 20 },
  footerText: { color: COLORS.dim, fontSize: 13, fontWeight: "600" },
});
