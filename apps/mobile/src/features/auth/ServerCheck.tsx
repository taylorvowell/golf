import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ApiClientError } from "../../platform/api";
import { api } from "../../platform/client";

/**
 * Proof, on the device, that the whole chain works: Google → Supabase session → bearer token →
 * our API → row-level security → this golfer's rows and nobody else's.
 *
 * Worth a screen of its own because each link fails differently and they are indistinguishable
 * from "sign-in is broken": a wrong client id fails at Google, a wrong Supabase project fails at
 * the token, a missing Authorization header comes back 401, and a LAN address the phone cannot
 * reach fails with a network error that looks exactly like being signed out.
 *
 * It shows the raw fault for that reason. This is developer-facing and goes when the real swing
 * log lands (mobile-player track).
 */

type State =
  | { kind: "loading" }
  | { kind: "ok"; count: number }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string };

export function ServerCheck() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const check = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const body = await api.request<{ swings: unknown[] }>("swings");
      setState({ kind: "ok", count: body.swings.length });
    } catch (err) {
      // 401 is its own state: it means the request reached the server and the server declined it,
      // which is a completely different problem from the request never arriving.
      if (err instanceof ApiClientError && err.status === 401) setState({ kind: "unauthorized" });
      else setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <Pressable onPress={() => void check()} style={styles.card} accessibilityRole="button">
      <Text style={styles.title}>Server</Text>
      <Text style={detail(state)} testID="server-check">
        {message(state)}
      </Text>
      <Text style={styles.hint}>Tap to re-check</Text>
    </Pressable>
  );
}

function message(state: State): string {
  switch (state.kind) {
    case "loading":
      return "checking…";
    case "ok":
      return `authenticated — ${state.count} swing${state.count === 1 ? "" : "s"} on this account`;
    case "unauthorized":
      return "401 — the server did not accept this session";
    case "error":
      return state.message;
  }
}

function detail(state: State) {
  if (state.kind === "ok") return styles.ok;
  if (state.kind === "loading") return styles.muted;
  return styles.bad;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: "#12161c",
    borderColor: "#232a33",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  title: { color: "#f7f8f5", fontSize: 13, fontWeight: "700" },
  ok: { color: "#a3e635", fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
  bad: { color: "#e5484d", fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
  muted: { color: "#7e8691", fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
  hint: { color: "#5b636e", fontSize: 10 },
});
