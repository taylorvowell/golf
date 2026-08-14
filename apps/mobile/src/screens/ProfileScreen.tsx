import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListGroup, ListRow } from "../design/ListRow";
import { Avatar } from "../features/profile/Avatar";
import { useAuth } from "../features/auth/AuthProvider";
import { useAppNavigation } from "../navigation";
import { themedStyles } from "../theme";

/**
 * The profile surface — slides in from the avatar on any tab.
 *
 * Identity at the top (the one place the signed-in address lives now), then the doors: coach,
 * stats, goals, settings, and the way out. "Swing stats" lands on the Progress tab rather than
 * a duplicate page — one screen per question, reachable from two places.
 */
export function ProfileScreen() {
  const navigation = useAppNavigation();
  const { email, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      // No navigation on success: the auth gate above the navigator swaps to the sign-in
      // screen the moment the session dies.
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <View style={styles.hero}>
        <Avatar size={72} />
        <Text style={styles.email} numberOfLines={1}>
          {email ?? "Signed in"}
        </Text>
      </View>

      <Text style={styles.tag}>My coach</Text>
      <ListGroup>
        <ListRow
          testID="profile-coach"
          title="Find a coach"
          subtitle="No coach yet — coaching opens with launch"
          onPress={() => navigation.navigate("Tabs", { screen: "Coach" })}
        />
      </ListGroup>

      <Text style={styles.tag}>Your game</Text>
      <ListGroup>
        <ListRow
          testID="profile-stats"
          title="Swing stats"
          subtitle="Bests, trends and records"
          onPress={() => navigation.navigate("Tabs", { screen: "Progress" })}
        />
        <ListRow
          testID="profile-goals"
          title="Goals"
          subtitle="What you're working toward"
          onPress={() => navigation.navigate("Goals")}
        />
      </ListGroup>

      <Text style={styles.tag}>App</Text>
      <ListGroup>
        <ListRow
          testID="profile-settings"
          title="Settings"
          onPress={() => navigation.navigate("Settings")}
        />
      </ListGroup>

      <ListGroup>
        <ListRow
          testID="profile-sign-out"
          title={signingOut ? "Signing out…" : "Log out"}
          onPress={() => void onSignOut()}
        />
      </ListGroup>
    </ScrollView>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 10 },
  hero: { alignItems: "center", gap: 12, paddingVertical: 22 },
  email: { color: t.text, fontSize: 15, fontWeight: "600", maxWidth: 280 },
  tag: {
    color: t.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 8,
    marginLeft: 4,
  },
}));
