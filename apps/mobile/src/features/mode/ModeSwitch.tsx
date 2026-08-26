import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT_BODY } from "../../design/system/typography";
import { useTheme } from "../../theme";
import { setAppMode, useAppMode, type AppMode } from "./appMode";
import { useInstructorEligible } from "./useRoles";

/**
 * The mode dropdown — Taylor's placement: the top bar, next to the menu icon. Renders NOTHING
 * for anyone without the instructor role (golfers never learn the control exists); for an
 * instructor it names the current mode and drops a two-row menu.
 *
 * A `Modal` rather than an inline absolute menu because the header slides out under scroll and
 * sits inside a `box-none` animated wrapper — a child menu would scroll away with it and fight
 * the wrapper for touches. The modal anchors visually under the bar instead. It opens in the
 * same commit and mounts a full-screen scrim, per the house Modal rules.
 *
 * The dot beside the OTHER mode's row is the cross-mode unread slot (architecture §7a) —
 * `false` today, a named seam for when instructor activity has a real unread count.
 */

const LABEL: Record<AppMode, string> = { personal: "Personal", instructor: "Instructor" };

export function ModeSwitch({ hero = false }: { hero?: boolean }) {
  const eligible = useInstructorEligible();
  const mode = useAppMode();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!eligible) return null;

  const ink = hero ? "#FFFFFF" : t.text;
  const otherHasUnread = false; // the cross-mode unread seam — wired by the inbox later

  const pick = (next: AppMode) => {
    setOpen(false);
    if (next !== mode) setAppMode(next);
  };

  return (
    <>
      <Pressable
        testID="mode-switch"
        accessibilityRole="button"
        accessibilityLabel={`App mode: ${LABEL[mode]}. Switch mode`}
        hitSlop={8}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
            height: 30,
            paddingHorizontal: 9,
            borderRadius: 15,
            backgroundColor: pressed
              ? hero
                ? "rgba(255,255,255,0.22)"
                : t.pressBed
              : "transparent",
          },
        ]}
      >
        <Text style={{ color: ink, fontFamily: FONT_BODY.semiBold, fontSize: 12.5 }}>
          {LABEL[mode]}
        </Text>
        <ChevronDown size={14} color={ink} strokeWidth={2.6} />
        {otherHasUnread && (
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: t.aqua,
              marginLeft: 1,
            }}
          />
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Full-screen dismiss scrim — one of the two sanctioned no-tap-state surfaces. */}
        <Pressable
          testID="mode-switch-scrim"
          accessibilityRole="button"
          accessibilityLabel="Close mode menu"
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
          onPress={() => setOpen(false)}
        >
          <View
            // Anchored under the header's right cluster; stops the scrim's press underneath it.
            onStartShouldSetResponder={() => true}
            style={{
              position: "absolute",
              top: insets.top + 52,
              right: 14,
              minWidth: 190,
              borderRadius: 16,
              backgroundColor: t.surface,
              paddingVertical: 6,
              gap: 2,
            }}
          >
            {(["personal", "instructor"] as const).map((option) => {
              const active = option === mode;
              return (
                <Pressable
                  key={option}
                  testID={`mode-option-${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${LABEL[option]} mode`}
                  onPress={() => pick(option)}
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingHorizontal: 14,
                      paddingVertical: 11,
                      marginHorizontal: 6,
                      borderRadius: 11,
                      backgroundColor: pressed ? t.surface3 : active ? t.surface2 : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: t.text,
                      fontFamily: active ? FONT_BODY.semiBold : FONT_BODY.regular,
                      fontSize: 13.5,
                    }}
                  >
                    {LABEL[option]}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {!active && otherHasUnread && (
                      <View
                        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.aqua }}
                      />
                    )}
                    {active && <Check size={15} color={t.cobalt} strokeWidth={2.8} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
