import { ScrollView, Switch, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListGroup, ListRow, ListSectionLabel } from "../design/system";
import { AllowanceMeter } from "../features/billing/AllowanceMeter";
import { useEntitlement } from "../features/billing/entitlement";
import { PLANS } from "../features/billing/plans";
import { FONT_BODY } from "../design/system/typography";
import { useAppPrefs } from "../features/settings/appPrefs";
import { useAppNavigation } from "../navigation";
import { CLIENT_VERSION } from "../platform/version";
import { themedStyles, useTheme } from "../theme";

/**
 * Settings — the app's real preferences, and only those. No placeholder toggles for features
 * that do not exist: a switch that does nothing teaches a golfer that switches here do nothing.
 * Delete account lives at the bottom, past everything, in the danger tone — it moved here from
 * the swing log's footer, which was only ever standing in for this screen.
 */

export function SettingsScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const t = useTheme();
  const { personal } = useEntitlement();
  const { tier, status } = personal;
  const [prefs, setPrefs] = useAppPrefs();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
      <ListSectionLabel>Plan</ListSectionLabel>
      <ListGroup>
        <ListRow
          testID="open-subscription"
          title={PLANS[tier].name}
          subtitle={
            status === "trialing"
              ? "On trial — see what happens when it ends"
              : status === "expired"
                ? "Your trial has ended"
                : "Your plan, allowance and billing"
          }
          onPress={() => navigation.navigate("Subscription")}
        />
      </ListGroup>
      <AllowanceMeter style={styles.meter} />

      <ListSectionLabel>Recording</ListSectionLabel>
      <ListGroup>
        <ListRow
          title="Play record and stop sound"
          subtitle="The camera's cue when recording starts and stops"
          right={
            <Switch
              value={prefs.recordSounds}
              onValueChange={(v) => setPrefs({ recordSounds: v })}
              trackColor={{ false: t.surface, true: t.aqua }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Play record and stop sound"
              testID="setting-recordSounds"
            />
          }
        />
        <ListRow
          title="Countdown beeps"
          subtitle="A soft tick at 3, 2 and 1 before recording"
          right={
            <Switch
              value={prefs.recordSounds && prefs.countdownTicks}
              disabled={!prefs.recordSounds}
              onValueChange={(v) => setPrefs({ countdownTicks: v })}
              trackColor={{ false: t.surface, true: t.aqua }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Countdown beeps"
              accessibilityState={{ disabled: !prefs.recordSounds }}
              testID="setting-countdownTicks"
            />
          }
        />
      </ListGroup>

      <ListSectionLabel>Account</ListSectionLabel>
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
          <ListSectionLabel>Developer</ListSectionLabel>
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

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  meter: { paddingHorizontal: 4, paddingTop: 2 },
  content: { padding: 16, gap: 10 },
  version: {
    color: t.muted2,
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    textAlign: "center",
    marginTop: 18,
  },
}));
