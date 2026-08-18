import { useState, type ComponentType } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  Bell,
  ChevronRight,
  Clock,
  HelpCircle,
  Lock,
  Settings as SettingsIcon,
  UserRound,
  X,
} from "lucide-react-native";

import { SideDrawer, type DrawerClose } from "../design/system";
import { FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { Avatar } from "../features/profile/Avatar";
import { useConnectedCoach } from "../features/profile/useConnectedCoach";
import { useAuth } from "../features/auth/AuthProvider";
import { useAppNavigation } from "../navigation";
import { themedStyles, useTheme } from "../theme";

/**
 * The profile surface — a drawer that slides in from the right over whatever tab opened it,
 * built to Taylor's design (2026-08-18): identity, the coach block, the menu, and the way out.
 *
 * **Only Settings has a screen behind it today.** My profile, Lesson history, Notifications,
 * Privacy and Help are the design's rows and are drawn exactly as designed, but they are inert
 * until those screens exist — a row is `MenuRow`'s `onPress`, so wiring one later is a single
 * line. The coach block's connected state comes from `useConnectedCoach`, which is sample data
 * under `__DEV__` and null in release until the coach platform lands.
 *
 * A row closes the drawer *before* it navigates, so coming back from Settings returns to the
 * tab rather than to a drawer left hanging open over it.
 *
 * The design's navy/white button pair maps to `cobalt`/`surface` rather than literal navy: a
 * navy fill on the dark theme's navy card is an invisible button.
 */

/** `bad` at 12% — a destructive action's bed (the named-tint pattern, not a hand-mix). */
const DANGER_BED = "rgba(229,87,100,0.12)";

export function ProfileScreen() {
  const navigation = useAppNavigation();
  const { email, firstName, signOut } = useAuth();
  const coach = useConnectedCoach();
  const t = useTheme();
  const styles = useStyles();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      // No navigation on success: the auth gate above the navigator swaps to the sign-in
      // screen the moment the session dies, drawer and all.
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SideDrawer testID="profile-drawer" onClosed={() => navigation.goBack()}>
      {(close: DrawerClose) => (
        <>
          <View style={styles.head}>
            <Text style={styles.headLabel}>Profile</Text>
            <Pressable
              testID="profile-close"
              accessibilityRole="button"
              accessibilityLabel="Close profile menu"
              hitSlop={10}
              onPress={() => close()}
              style={({ pressed }) => [styles.closeCap, pressed && styles.closeCapPressed]}
            >
              <X size={17} color={t.text} strokeWidth={2.6} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Identity. The design's second line is a location; the app holds no location, so
                it is the signed-in address — the one place that lives now. */}
            <View style={styles.account}>
              <Avatar size={56} />
              <View style={styles.accountText}>
                <Text style={styles.microLabel}>Account</Text>
                <Text style={styles.accountName} numberOfLines={1}>
                  {firstName ?? "Your account"}
                </Text>
                <Text style={styles.accountSub} numberOfLines={1}>
                  {email ?? "Signed in"}
                </Text>
              </View>
            </View>

            <Text style={styles.section}>Coach</Text>

            {coach ? (
              <LinearGradient
                colors={[t.aquaSoft, t.surfaceBlue]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.coachCard}
              >
                <View style={styles.coachHead}>
                  <View style={styles.coachDisc}>
                    <Text style={styles.coachInitials}>{coach.initials}</Text>
                  </View>
                  <View style={styles.accountText}>
                    <Text style={styles.microLabel}>Your coach</Text>
                    <Text style={styles.coachName}>{coach.name}</Text>
                  </View>
                </View>
                <Text style={styles.coachBlurb}>{coach.blurb}</Text>
                <View style={styles.coachActions}>
                  <Pressable
                    testID="profile-coach-message"
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${coach.name}`}
                    style={({ pressed }) => [styles.coachPrimary, pressed && styles.pressedFade]}
                  >
                    <Text style={styles.coachPrimaryLabel}>Message coach</Text>
                  </Pressable>
                  <Pressable
                    testID="profile-coach-view"
                    accessibilityRole="button"
                    accessibilityLabel={`View ${coach.name}'s profile`}
                    style={({ pressed }) => [styles.coachSecondary, pressed && styles.pressedFade]}
                  >
                    <Text style={styles.coachSecondaryLabel}>View profile</Text>
                  </Pressable>
                </View>
              </LinearGradient>
            ) : null}

            {/* The directory. Its door is the Coach tab, which is the honest version of "browse
                instructors" until a marketplace exists behind it. */}
            <View style={styles.directory}>
              <Text style={styles.microLabel}>Local coach directory</Text>
              <Text style={styles.directoryTitle}>Find coaches near you</Text>
              <Text style={styles.directoryCopy}>
                Browse verified instructors by location and connect one to your account for
                in-person lessons and app-based feedback.
              </Text>
              <View style={styles.directoryFoot}>
                <View style={styles.chip}>
                  <Text style={styles.chipLabel}>Near you</Text>
                </View>
                <Pressable
                  testID="profile-coach"
                  accessibilityRole="button"
                  accessibilityLabel="Find a coach"
                  onPress={() => close(() => navigation.navigate("Tabs", { screen: "Coach" }))}
                  style={({ pressed }) => [styles.directoryCta, pressed && styles.pressedFade]}
                >
                  <Text style={styles.directoryCtaLabel}>Find coach</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.section}>Menu</Text>
            <View style={styles.group}>
              <MenuRow
                testID="profile-my-profile"
                icon={UserRound}
                title="My profile"
                subtitle="Personal info and golfer details"
              />
              <MenuRow
                testID="profile-lesson-history"
                icon={Clock}
                title="Lesson history"
                subtitle="Sessions, notes, and coach activity"
              />
              <MenuRow
                testID="profile-notifications"
                icon={Bell}
                title="Notifications"
                subtitle="Practice reminders and coach updates"
              />
              <MenuRow
                testID="profile-settings"
                icon={SettingsIcon}
                title="Settings"
                subtitle="Playback, capture, and app preferences"
                onPress={() => close(() => navigation.navigate("Settings"))}
              />
              <MenuRow
                testID="profile-privacy"
                icon={Lock}
                title="Privacy"
                subtitle="Permissions, visibility, and account controls"
              />
              <MenuRow
                testID="profile-help"
                icon={HelpCircle}
                title="Help"
                subtitle="Guides, filming tips, and support"
              />
            </View>

            <Pressable
              testID="profile-sign-out"
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={() => void onSignOut()}
              style={({ pressed }) => [styles.signOut, pressed && styles.pressedFade]}
            >
              <Text style={styles.signOutLabel}>{signingOut ? "Signing out…" : "Sign out"}</Text>
            </Pressable>
          </ScrollView>
        </>
      )}
    </SideDrawer>
  );
}

/**
 * A menu row: tinted glyph tile, the label over what it holds, and the chevron.
 *
 * Without `onPress` it is a plain `View` — same drawing, no press feedback and no accessibility
 * button role, so a row whose screen does not exist yet reads as "not yet" rather than broken.
 */
function MenuRow({
  icon: Icon,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  subtitle: string;
  onPress?: () => void;
  testID?: string;
}) {
  const t = useTheme();
  const styles = useStyles();

  const body = (
    <>
      <View style={styles.rowIcon}>
        <Icon size={18} color={t.text} strokeWidth={2} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <ChevronRight size={16} color={t.muted2} strokeWidth={2.5} />
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  // Every number below is the prototype's, converted from its Tailwind step: px-5 → 20,
  // rounded-2xl → 16, p-3.5 → 14, tracking-[0.14em] at 11px → 1.54, and so on. Sora replaces
  // Bahnschrift as the display face because that is the app's face — the scale is the design's.
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 11,
    letterSpacing: 1.54,
    textTransform: "uppercase",
  },
  closeCap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  closeCapPressed: { backgroundColor: t.surface3 },
  pressedFade: { opacity: 0.75 },

  // No container gap: the prototype spaces with explicit margins (mt-3, mt-6, space-y-2), and
  // a gap on top of those would double every one of them.
  content: { paddingHorizontal: 20, paddingBottom: 24 },

  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.surface,
  },
  accountText: { flex: 1, minWidth: 0 },
  microLabel: {
    color: t.muted2,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.96,
    textTransform: "uppercase",
  },
  accountName: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 17,
    lineHeight: 18,
    marginTop: 4,
  },
  accountSub: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },

  section: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.26,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 8,
  },

  coachCard: { padding: 16, borderRadius: 16 },
  coachHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  coachDisc: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  coachInitials: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  coachName: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 16,
    lineHeight: 19,
    marginTop: 4,
  },
  coachBlurb: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 10,
  },
  coachActions: { flexDirection: "row", gap: 8, marginTop: 16 },
  coachPrimary: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  coachPrimaryLabel: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  coachSecondary: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface,
  },
  coachSecondaryLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },

  directory: {
    padding: 16,
    borderRadius: 16,
    marginTop: 12,
    backgroundColor: t.surface,
  },
  directoryTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 17,
    lineHeight: 20,
    marginTop: 4,
  },
  directoryCopy: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 6,
  },
  directoryFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 14,
  },
  chip: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  chipLabel: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  directoryCta: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 12,
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  directoryCtaLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },

  /** `space-y-2` — spacing separates the rows, never a divider. */
  group: { gap: 8 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.surface,
  },
  rowPressed: { backgroundColor: t.surface2 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  rowSub: {
    color: t.muted,
    fontFamily: FONT_BODY.regular,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 4,
  },

  signOut: {
    height: 44,
    marginTop: 20,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DANGER_BED,
  },
  signOutLabel: {
    color: t.bad,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.81,
    textTransform: "uppercase",
  },
}));
