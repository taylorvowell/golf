import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "../features/profile/Avatar";
import { useAppNavigation } from "../navigation";
import { themedStyles } from "../theme";

/**
 * The tab screens' shared header: the screen's name on the left, the golfer on the right.
 *
 * The avatar is the one persistent door into the profile surface, so it appears on every tab in
 * the same corner. It owns the top inset (the tab navigator draws no header), and in development
 * builds it steps left of the expo-dev-client bubble — the same accommodation the old account
 * bar carried, gated so release keeps the corner.
 */
export function TopBar({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const styles = useStyles();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 10 }]}>
      <Text style={styles.title}>{title}</Text>
      <Pressable
        testID="open-profile"
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={() => navigation.navigate("Profile")}
        hitSlop={8}
        style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
      >
        <Avatar size={34} />
      </Pressable>
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: t.bg,
  },
  title: { color: t.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.6 },
  // The dev-client bubble pins to the top-right and swallows taps; release keeps the corner.
  avatar: { marginRight: __DEV__ ? 56 : 0 },
  pressed: { opacity: 0.7 },
}));
