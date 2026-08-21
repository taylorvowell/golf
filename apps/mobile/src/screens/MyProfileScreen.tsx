import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useAuth } from "../features/auth/AuthProvider";
import { Avatar } from "../features/profile/Avatar";
import { FieldEditorSheet } from "../features/profile/FieldEditorSheet";
import {
  PROFILE_FIELDS,
  displayValue,
  type ProfileField,
} from "../features/profile/profileFields";
import { IdentitySheet } from "../features/profile/IdentitySheet";
import { useProfile } from "../features/profile/useProfile";
import { themedStyles } from "../theme";

/**
 * My profile — six questions, two columns, nothing else (Taylor, 2026-08-20, final shape).
 * The identity card up top edits name + region; each tile below is one answer, tapped open in
 * its editor sheet. The registry (`profileFields.ts`) decides the six — this screen renders
 * whatever it says and adds nothing of its own.
 */
export function MyProfileScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { firstName } = useAuth();
  const { state } = useProfile();
  const [editing, setEditing] = useState<ProfileField | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);

  if (state.kind !== "ok") {
    // Loading and unreachable draw the same quiet shell — the tiles arrive when the wire
    // does, and a profile screen has nothing urgent enough to justify an error wall.
    return <View style={styles.root} />;
  }

  const priv = state.profile.private;

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Tapping identity edits it (§5.1's public half) — name and region, nothing more. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your name and region"
          testID="profile-identity"
          onPress={() => setIdentityOpen(true)}
          style={({ pressed }) => [styles.head, pressed && styles.headPressed]}
        >
          <Avatar size={52} />
          <View style={styles.headText}>
            <Text style={styles.headName} numberOfLines={1}>
              {state.profile.public.displayName || firstName || "Your account"}
            </Text>
            {state.profile.public.region ? (
              <Text style={styles.headMeta} numberOfLines={1}>
                {state.profile.public.region}
              </Text>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.grid}>
          {PROFILE_FIELDS.map((field) => {
            const value = displayValue(field, priv);
            return (
              <Pressable
                key={field.key}
                accessibilityRole="button"
                accessibilityLabel={
                  value ? `${field.label}: ${value}` : `${field.label}, not set`
                }
                testID={`profile-tile-${field.key}`}
                onPress={() => setEditing(field)}
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              >
                <Text style={styles.tileLabel}>{field.label}</Text>
                <Text
                  style={[styles.tileValue, value === null && styles.tileValueEmpty]}
                  numberOfLines={2}
                >
                  {value ?? "Add"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <FieldEditorSheet field={editing} onClose={() => setEditing(null)} />
      {/* Keyed remount so the inputs re-seed from the confirmed values on every open. */}
      {identityOpen ? (
        <IdentitySheet
          visible
          onClose={() => setIdentityOpen(false)}
          displayName={state.profile.public.displayName || firstName || ""}
          region={state.profile.public.region}
        />
      ) : null}
    </>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  content: { padding: 16, gap: 10 },

  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: t.surface,
  },
  headPressed: { backgroundColor: t.surface2 },
  headText: { flex: 1, minWidth: 0, gap: 4 },
  headName: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 17,
    lineHeight: displayLine(17),
  },
  headMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11 },

  /** Two columns, three rows — the whole profile. */
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: {
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 76,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 5,
    backgroundColor: t.surface,
  },
  tilePressed: { backgroundColor: t.surface2 },
  tileLabel: {
    color: t.muted2,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 8,
    letterSpacing: 0.96,
    textTransform: "uppercase",
  },
  tileValue: {
    color: t.text,
    fontFamily: FONT_DISPLAY.extraBold,
    fontSize: 14,
    lineHeight: displayLine(14),
  },
  tileValueEmpty: { color: t.muted2, fontFamily: FONT_DISPLAY.bold },
}));
