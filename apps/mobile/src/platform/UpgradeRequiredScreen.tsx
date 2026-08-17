import { Linking, Text, View } from "react-native";
import type { UpgradeRequired } from "@swingsage/schema/contract";

import { Button, Eyebrow, Panel, TitleText } from "../design/system";
import { FONT_BODY } from "../design/system/typography";
import { themedStyles } from "../theme";

export interface UpgradeRequiredScreenProps {
  detail: UpgradeRequired;
  /** Injected in tests; defaults to the platform's own store handler. */
  onOpenStore?: (url: string) => void;
}

/**
 * What a build too old to be served shows instead of a failed request.
 *
 * This screen is the entire reason the 426 exists. Without it an unsupported build shows a
 * spinner, a generic network error, or an empty list — all of which read as "SwingSage is
 * broken", and none of which a golfer can act on. The one thing they can do is update, so that
 * is the only thing on screen.
 *
 * Deliberately terminal: no retry, no dismiss. Retrying cannot succeed, and a dismissable
 * blocker is one a user learns to dismiss.
 */
export default function UpgradeRequiredScreen({
  detail,
  onOpenStore,
}: UpgradeRequiredScreenProps) {
  const open = onOpenStore ?? ((url: string) => void Linking.openURL(url));
  const styles = useStyles();

  return (
    <View style={styles.root} testID="upgrade-required">
      <Panel radius="feature" style={styles.card}>
        <Eyebrow>Update required</Eyebrow>
        <TitleText>SwingSage needs updating</TitleText>
        <Text style={styles.body}>
          {detail.message ??
            "This version is too old to read your swings safely. Your swings are all still here."}
        </Text>
        <Text style={styles.meta}>
          This build requires {detail.minimumVersion} or newer. The current release is{" "}
          {detail.currentVersion}.
        </Text>
        {detail.storeUrl ? (
          <Button
            label="Update SwingSage"
            testID="upgrade-open-store"
            onPress={() => open(detail.storeUrl as string)}
            style={styles.button}
          />
        ) : (
          // No store link is a server-side gap, not the golfer's problem — say what to do anyway
          // rather than showing a button that goes nowhere.
          <Text style={styles.meta} testID="upgrade-no-store">
            Update SwingSage from your device&apos;s app store to continue.
          </Text>
        )}
      </Panel>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg, justifyContent: "center", padding: 20 },
  card: { padding: 20, gap: 10 },
  body: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 14, lineHeight: 21 },
  meta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12, lineHeight: 18 },
  button: { marginTop: 6, alignSelf: "stretch" },
}));
