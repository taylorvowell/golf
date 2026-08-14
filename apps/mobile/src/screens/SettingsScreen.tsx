import { ScrollView, StyleSheet, Switch, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListGroup, ListRow } from "../design/ListRow";
import { useSummaryPreference } from "../features/swings/useSummaryPreference";
import { useAppNavigation } from "../navigation";
import { CLIENT_VERSION } from "../platform/version";
import { COLORS } from "../theme";

/**
 * Settings — the app's real preferences, and only those. No placeholder toggles for features
 * that do not exist: a switch that does nothing teaches a golfer that switches here do nothing.
 * Delete account lives at the bottom, past everything, in the danger tone — it moved here from
 * the swing log's footer, which was only ever standing in for this screen.
 */
export function SettingsScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { statsFirst, set } = useSummaryPreference();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <Text style={styles.tag}>After a swing</Text>
      <ListGroup>
        <ListRow
          title="Lead with the scorecard"
          subtitle="Slide the summary up over the video after each swing"
          right={
            <Switch
              testID="setting-stats-first"
              value={statsFirst ?? true}
              // Null means the stored value has not loaded yet — a flip written now would race it.
              disabled={statsFirst === null}
              onValueChange={set}
              trackColor={{ false: COLORS.border, true: "rgba(163,230,53,0.45)" }}
              thumbColor={statsFirst ? COLORS.acid : COLORS.muted}
            />
          }
        />
      </ListGroup>

      <Text style={styles.tag}>Account</Text>
      <ListGroup>
        <ListRow
          testID="open-delete-account"
          title="Delete account"
          subtitle="Removes your account and every swing, permanently"
          danger
          onPress={() => navigation.navigate("DeleteAccount")}
        />
      </ListGroup>

      <Text style={styles.version}>SwingSage {CLIENT_VERSION}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, gap: 10 },
  tag: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 8,
    marginLeft: 4,
  },
  version: { color: COLORS.dim, fontSize: 11, textAlign: "center", marginTop: 18 },
});
