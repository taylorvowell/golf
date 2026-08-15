import { ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListGroup, ListRow } from "../design/ListRow";
import { useSummaryPreference } from "../features/swings/useSummaryPreference";
import { useAppNavigation } from "../navigation";
import { CLIENT_VERSION } from "../platform/version";
import { themedStyles, useTheme, useThemePreference, type ThemePreference } from "../theme";

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
  const t = useTheme();
  const styles = useStyles();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <Text style={styles.tag}>Appearance</Text>
      <AppearancePicker />

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
              trackColor={{ false: t.well, true: t.accentTrack }}
              thumbColor={statsFirst ? t.accent : t.muted}
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

      {__DEV__ && (
        <>
          <Text style={styles.tag}>Developer</Text>
          <ListGroup>
            <ListRow
              title="Design system gallery"
              subtitle="Every primitive, both themes — the living spec"
              onPress={() => navigation.navigate("SystemGallery")}
            />
          </ListGroup>
        </>
      )}

      <Text style={styles.version}>SwingSage {CLIENT_VERSION}</Text>
    </ScrollView>
  );
}

const APPEARANCE_CHOICES: ReadonlyArray<{
  value: ThemePreference;
  title: string;
  subtitle?: string;
}> = [
  { value: "system", title: "Match my phone", subtitle: "Dark when your phone is" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
];

/** One choice of three; light is where an untouched phone lands (`system` on a light phone). */
function AppearancePicker() {
  const { preference, set } = useThemePreference();

  return (
    <ListGroup>
      {APPEARANCE_CHOICES.map((choice) => (
        <ListRow
          key={choice.value}
          testID={`setting-appearance-${choice.value}`}
          title={choice.title}
          {...(choice.subtitle ? { subtitle: choice.subtitle } : {})}
          selected={preference === choice.value}
          // Until the stored value loads, no row is marked and a tap simply wins the race —
          // `set` writes the cache before the read resolves, so nothing flips back.
          onPress={() => set(choice.value)}
          right={<ChoiceMark selected={preference === choice.value} />}
        />
      ))}
    </ListGroup>
  );
}

/** A flat radio: accent disc with a punched centre when chosen, a well when not. */
function ChoiceMark({ selected }: { selected: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.mark, selected && styles.markSelected]}>
      {selected ? <View style={styles.markDot} /> : null}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 10 },
  tag: {
    color: t.muted,
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 8,
    marginLeft: 4,
  },
  version: { color: t.dim, fontSize: 11, textAlign: "center", marginTop: 18 },

  mark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.well,
  },
  markSelected: { backgroundColor: t.accent },
  markDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: t.onAccent },
}));
