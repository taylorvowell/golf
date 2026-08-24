import { View, type ViewProps } from "react-native";

import { useAuth } from "./AuthProvider";
import { themedStyles, useTheme } from "../../theme";
import { SignInScreen } from "./SignInScreen";
import { SwingLoader } from "../../design/system/SwingLoader";

export interface AuthGateProps {
  children: ViewProps["children"];
}

/**
 * Nothing renders until we know who is asking.
 *
 * The gate is a single place rather than a check on each screen for the same reason
 * `route-auth.test.ts` exists on the server: a per-screen guard is a guard someone forgets to add,
 * and the one they forget is the one that shows another person's swing.
 *
 * `loading` draws a spinner, not the sign-in screen. Drawing sign-in while a stored session is
 * still being read makes a returning golfer watch their own login screen flash past on every cold
 * start, which reads as the app having forgotten them.
 */
export function AuthGate({ children }: AuthGateProps) {
  const { status } = useAuth();
  const t = useTheme();
  const styles = useStyles();

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <SwingLoader size={76} />
      </View>
    );
  }

  if (status === "signed-out") return <SignInScreen />;

  return <>{children}</>;
}

const useStyles = themedStyles((t) => ({
  center: { flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" },
}));
