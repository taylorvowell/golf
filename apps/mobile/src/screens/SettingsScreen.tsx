import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ListGroup, ListRow, ListSectionLabel } from "../design/system";
import { FONT_BODY } from "../design/system/typography";
import { useAppNavigation } from "../navigation";
import { CLIENT_VERSION } from "../platform/version";
import { themedStyles } from "../theme";

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

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
    >
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
  content: { padding: 16, gap: 10 },
  version: {
    color: t.muted2,
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    textAlign: "center",
    marginTop: 18,
  },
}));
