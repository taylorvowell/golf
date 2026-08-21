import { Text, View } from "react-native";

import { Button } from "./system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "./system/typography";
import { themedStyles } from "../theme";

/**
 * A centred full-area status — the expired-session and cannot-reach states, shared by Home and
 * the swing log so the two screens cannot drift into wording the same failure differently.
 * The retry button is part of the contract: a state a golfer can do nothing about is a state
 * this component must not be used for.
 */
export function StatusMessage({
  title,
  detail,
  onRetry,
  retryTestID = "status-retry",
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  retryTestID?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.centre}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      <Button
        variant="secondary"
        label="Try again"
        onPress={onRetry}
        testID={retryTestID}
        style={styles.retry}
      />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 18,
    lineHeight: displayLine(18),
    textAlign: "center",
  },
  detail: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: "center",
    maxWidth: 300,
  },
  retry: { marginTop: 6, alignSelf: "center" },
}));
