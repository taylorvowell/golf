import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { ApiClientError } from "../platform/api";
import { api } from "../platform/client";
import { COLORS } from "../theme";

/**
 * The signed-in golfer's home. Placeholder by design, honest by requirement.
 *
 * It replaces the step 02 spike harness, which is deleted. The swing list, capture entry point and
 * navigation that belong here are the `mobile-app-shell` and `mobile-player` tracks — this screen
 * is what stands in front of a golfer until those land, so it has to be a real product surface
 * rather than a debug card: no raw fault strings, no probe vocabulary, no counts nobody asked for.
 *
 * The state machine is the part worth keeping. "Zero swings" and "we could not ask" are different
 * answers and the product principle is that an uncertain finding is never presented as fact — a
 * network failure rendering as an empty log tells a golfer their swings are gone. Every non-ok
 * state therefore says what actually happened and offers the retry.
 */

type State =
  | { kind: "loading" }
  | { kind: "ok"; count: number }
  | { kind: "signed-out" }
  | { kind: "unreachable" };

export interface HomeScreenProps {
  /**
   * §4.3 has to be reachable from somewhere, and there is no settings screen yet — that is
   * `mobile-app-shell`. A quiet footer link is where a golfer looks for it in the meantime;
   * inventing a settings surface here would be the second one when that track ships.
   */
  onDeleteAccount: () => void;
}

export function HomeScreen({ onDeleteAccount }: HomeScreenProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const body = await api.request<{ swings: unknown[] }>("swings");
      setState({ kind: "ok", count: body.swings.length });
    } catch (err) {
      // A 401 reached the server and was declined; anything else never got an answer at all.
      // Collapsing the two loses the only clue that distinguishes "sign in again" from "no signal".
      const declined = err instanceof ApiClientError && err.status === 401;
      setState({ kind: declined ? "signed-out" : "unreachable" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Your swings</Text>
      <View style={styles.body} testID="home-state">
        {state.kind === "loading" ? <ActivityIndicator color={COLORS.muted} /> : null}
        {state.kind === "ok" ? <Loaded count={state.count} /> : null}
        {state.kind === "signed-out" ? (
          <Retryable
            title="Your session has expired"
            detail="Sign out and sign back in to continue."
            onRetry={load}
          />
        ) : null}
        {state.kind === "unreachable" ? (
          <Retryable
            title="Cannot reach SwingSage"
            detail="Your swings are safe — this device just could not connect. Check your network."
            onRetry={load}
          />
        ) : null}
      </View>
      <Pressable
        onPress={onDeleteAccount}
        accessibilityRole="button"
        testID="home-delete-account"
        style={({ pressed }) => [styles.footer, pressed && styles.footerPressed]}
      >
        <Text style={styles.footerText}>Delete account</Text>
      </Pressable>
    </View>
  );
}

function Loaded({ count }: { count: number }) {
  if (count === 0) {
    return (
      <>
        <Text style={styles.title}>No swings yet</Text>
        <Text style={styles.detail}>
          Recording and upload arrive with the capture release. Swings you add will appear here.
        </Text>
      </>
    );
  }
  return (
    <>
      <Text style={styles.title}>
        {count} swing{count === 1 ? "" : "s"}
      </Text>
      <Text style={styles.detail}>
        Opening a swing arrives with the player release. They are recorded and safe.
      </Text>
    </>
  );
}

function Retryable({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        testID="home-retry"
        style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
      >
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },
  heading: { color: COLORS.text, fontSize: 26, fontWeight: "700" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
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
    paddingVertical: 10,
  },
  retryPressed: { opacity: 0.6 },
  retryText: { color: COLORS.text, fontSize: 13, fontWeight: "700" },
  // Quiet and at the bottom on purpose: it is the only irreversible action in the app, and a
  // destructive control competing for attention with the primary one gets tapped by mistake.
  footer: { alignItems: "center", paddingVertical: 16 },
  footerPressed: { opacity: 0.6 },
  footerText: { color: COLORS.dim, fontSize: 13, fontWeight: "600" },
});
