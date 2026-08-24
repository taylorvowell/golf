import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { ChevronLeft, CloudOff } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RolesResponse } from "@swingsage/schema/contract";

import { BrandMark, PoseOutline } from "../../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../../design/system/typography";
import { useAppNavigation } from "../../navigation";
import { api } from "../../platform/client";
import { themedStyles, useTheme } from "../../theme";
import { useAuth } from "../auth/AuthProvider";
import { HANDICAP_OPTIONS, STYLE_OPTIONS } from "../profile/profileFields";
import { saveProfile, useProfile } from "../profile/useProfile";
import { useToast } from "../toast/ToastProvider";
import { AttachEmailStep } from "./AttachEmailStep";

/**
 * Onboarding — §4.4's role selection and §5.4's handful of questions, one full-screen question
 * at a time. Auto-opened after signup (see `OnboardingLauncher`) and relaunchable from the
 * debug menu, which is also how it is revisited after a skip.
 *
 * The rules it encodes:
 *  - **Handedness is the only required answer** — the one step without Skip. Every other
 *    question is skippable on the spot, because §45's success definition starts with "create
 *    an account quickly" and a wall of questions is how that dies.
 *  - **Every answer saves the moment it is tapped** — the profile row is the draft (§4.4's
 *    "resumable" reduces to that), so backing out mid-flow loses nothing and the flow reopens
 *    showing what was already said.
 *  - **Every step advances itself on the tap.** A Continue button under a tapped card is a
 *    second tap for nothing.
 *  - Finishing stamps `completeOnboarding` — after which the launcher never auto-opens again.
 */

type StepId = "role" | "handedness" | "style" | "handicap" | "email";
const BASE_STEPS: StepId[] = ["role", "handedness", "style", "handicap"];

export function OnboardingScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const t = useTheme();
  const toast = useToast();
  const { state } = useProfile();
  const { email } = useAuth();
  const priv = state.kind === "ok" ? state.profile.private : null;

  // The roster is FROZEN at open. The email question exists only for an account with no address
  // (signed up by phone — the one-golfer-one-account seam), and verifying it mid-flow updates the
  // session's email; a roster derived live would shrink under the golfer's feet and skip a step.
  //
  // It comes FIRST, and that ordering is load-bearing: `users.email` is NOT NULL and
  // `app.ensure_profile()` raises SS_EMAIL_REQUIRED for an identity without an address
  // (`decisions/auth-identity.md`), so every savePatch/claimRoles call below would 500 until the
  // email lands. Attaching goes through Supabase auth directly — no API route is involved, which
  // is exactly why this step works while the account cannot yet reach the API.
  const [steps] = useState<StepId[]>(() => (email ? BASE_STEPS : ["email", ...BASE_STEPS]));

  const [index, setIndex] = useState(0);
  const step = steps[index];

  // A quiet slide-and-fade between questions — enough motion to say "next", nothing to wait on.
  const enter = useRef(new Animated.Value(1)).current;
  const goTo = (next: number) => {
    enter.setValue(0);
    setIndex(next);
    Animated.timing(enter, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  };

  const savePatch = (patch: Parameters<typeof saveProfile>[0]) => {
    saveProfile(patch).catch(() => {
      toast({
        id: `onboarding-save-failed-${Date.now()}`,
        title: "Couldn't save",
        detail: "Check your connection — your answers retry when you finish.",
        icon: CloudOff,
      });
    });
  };

  const advance = () => {
    if (index < steps.length - 1) goTo(index + 1);
    else finish();
  };

  const finish = () => {
    // The stamp is the one save worth insisting on — without it the flow reopens every launch.
    saveProfile({ completeOnboarding: true }).catch(() => {
      toast({
        id: "onboarding-finish-failed",
        title: "Couldn't finish setup",
        detail: "Your answers are safe — we'll try again next time.",
        icon: CloudOff,
      });
    });
    navigation.goBack();
  };

  const claimRoles = (roles: ("golfer" | "coach")[]) => {
    for (const role of roles) {
      api
        .request<RolesResponse>("roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        })
        .catch(() => undefined); // idempotent and re-claimable from the profile later
    }
  };

  const dots = useMemo(
    () => (
      <View style={styles.dots}>
        {steps.map((s, i) => (
          <View key={s} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    ),
    [index, steps, styles],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <View style={styles.topRow}>
        {/* No back INTO the email step — once verified it has nothing left to do, and
            re-submitting the same address is a dead end the golfer cannot advance out of. */}
        {index > 0 && steps[index - 1] !== "email" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous question"
            hitSlop={10}
            onPress={() => goTo(index - 1)}
            style={({ pressed }) => [styles.backCap, pressed && styles.capPressed]}
          >
            <ChevronLeft size={18} color={t.text} strokeWidth={2.6} />
          </Pressable>
        ) : (
          <View style={styles.backCap}>
            <BrandMark size={18} />
          </View>
        )}
        {dots}
        {/* Handedness is required by the product; email is required by the schema — a
            phone-only account cannot store anything until an address exists. */}
        {step !== "handedness" && step !== "email" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip this question"
            testID="onboarding-skip"
            hitSlop={10}
            onPress={advance}
            style={({ pressed }) => [styles.skip, pressed && styles.capPressed]}
          >
            <Text style={styles.skipLabel}>Skip</Text>
          </Pressable>
        ) : (
          <View style={styles.skip} />
        )}
      </View>

      <Animated.View
        style={[
          styles.body,
          {
            opacity: enter,
            transform: [
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            ],
          },
        ]}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 28 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {step === "role" && (
            <>
              <Text style={styles.question}>How will you use SwingSage?</Text>
              {(
                [
                  { key: "golfer", label: "I'm a golfer", roles: ["golfer"] as const },
                  { key: "coach", label: "I'm a coach", roles: ["coach"] as const },
                  { key: "both", label: "Both", roles: ["golfer", "coach"] as const },
                ] as const
              ).map((opt) => (
                <BigCard
                  key={opt.key}
                  label={opt.label}
                  testID={`onboarding-role-${opt.key}`}
                  onPress={() => {
                    claimRoles([...opt.roles]);
                    advance();
                  }}
                />
              ))}
            </>
          )}

          {step === "handedness" && (
            <>
              <Text style={styles.question}>Which side do you swing from?</Text>
              <View style={styles.handedRow}>
                {(
                  [
                    { value: "right", label: "Right-handed", mirrored: false },
                    { value: "left", label: "Left-handed", mirrored: true },
                  ] as const
                ).map((opt) => {
                  const selected = priv?.handedness === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={opt.label}
                      testID={`onboarding-handedness-${opt.value}`}
                      onPress={() => {
                        savePatch({ private: { handedness: opt.value } });
                        advance();
                      }}
                      style={({ pressed }) => [
                        styles.handedCard,
                        selected && styles.cardSelected,
                        pressed && !selected && styles.cardPressed,
                      ]}
                    >
                      <PoseOutline
                        pose="face_on"
                        width={84}
                        height={150}
                        color={selected ? t.cobalt : t.muted}
                        strokeWidth={1.4}
                        mirrored={opt.mirrored}
                      />
                      <Text style={[styles.handedLabel, selected && styles.cardLabelSelected]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {step === "style" && (
            <>
              <Text style={styles.question}>How would you describe your swing?</Text>
              {STYLE_OPTIONS.map((opt) => (
                <BigCard
                  key={String(opt.value)}
                  label={opt.label}
                  detail={opt.detail}
                  selected={priv?.selfReportedStyle === opt.value}
                  testID={`onboarding-style-${String(opt.value)}`}
                  onPress={() => {
                    savePatch({
                      private: {
                        selfReportedStyle:
                          opt.value as NonNullable<typeof priv>["selfReportedStyle"],
                      },
                    });
                    advance();
                  }}
                />
              ))}
            </>
          )}

          {step === "handicap" && (
            <>
              <Text style={styles.question}>Know your handicap?</Text>
              <View style={styles.handicapWrap}>
                {HANDICAP_OPTIONS.map((opt) => {
                  const selected = priv?.handicapRange === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Handicap ${opt.label}`}
                      testID={`onboarding-handicap-${opt.value}`}
                      onPress={() => {
                        savePatch({
                          private: {
                            handicapRange:
                              opt.value as NonNullable<typeof priv>["handicapRange"],
                          },
                        });
                        // advance, not finish — the email question follows for an account
                        // that has no address yet.
                        advance();
                      }}
                      style={[styles.hcpChip, selected && styles.hcpChipOn]}
                    >
                      <Text style={[styles.hcpLabel, selected && styles.hcpLabelOn]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {step === "email" && (
            <>
              <Text style={styles.question}>Add your email</Text>
              <Text style={styles.stepLede}>
                Your account needs one — and you&apos;ll be able to sign in with your phone or
                your email, same account either way. We&apos;ll send a code to confirm it.
              </Text>
              <AttachEmailStep onDone={advance} />
            </>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function BigCard({
  label,
  detail,
  selected,
  onPress,
  testID,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selected ?? false }}
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && !selected && styles.cardPressed,
      ]}
    >
      <Text style={[styles.cardLabel, selected && styles.cardLabelSelected]}>{label}</Text>
      {detail ? <Text style={styles.cardDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  backCap: {
    width: 40,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  capPressed: { backgroundColor: t.surface2, borderRadius: 12 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.surface3 },
  dotOn: { backgroundColor: t.cobalt, width: 18 },
  skip: { minWidth: 40, height: 36, alignItems: "center", justifyContent: "center" },
  skipLabel: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },

  body: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 26, gap: 10 },

  question: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 26,
    lineHeight: displayLine(26),
    marginBottom: 14,
  },
  stepLede: {
    color: t.textSoft,
    fontFamily: FONT_BODY.regular,
    fontSize: 13,
    lineHeight: 20,
    marginTop: -8,
    marginBottom: 6,
  },

  card: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 4,
    backgroundColor: t.surface,
  },
  cardSelected: { backgroundColor: t.surfaceBlue },
  cardPressed: { backgroundColor: t.surface2 },
  cardLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 16,
    lineHeight: displayLine(16),
  },
  cardLabelSelected: { color: t.cobalt },
  cardDetail: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 12, lineHeight: 17 },

  handedRow: { flexDirection: "row", gap: 10 },
  handedCard: {
    flex: 1,
    alignItems: "center",
    gap: 14,
    borderRadius: 18,
    paddingVertical: 26,
    backgroundColor: t.surface,
  },
  handedLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 13,
    lineHeight: displayLine(13),
  },

  continue: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    backgroundColor: t.cobalt,
  },
  continuePressed: { backgroundColor: t.cobaltPressed },
  continueLabel: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  orLine: {
    color: t.muted,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 1.26,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 2,
  },
  handicapWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hcpChip: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface,
  },
  hcpChipOn: { backgroundColor: t.cobalt },
  hcpLabel: { color: t.text, fontFamily: FONT_DISPLAY.extraBold, fontSize: 12 },
  hcpLabelOn: { color: t.onDark },
}));
