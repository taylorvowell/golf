import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CloudOff, ImageOff, Pencil } from "lucide-react-native";

import { Input } from "../design/system";
import { displayLine, FONT_BODY, FONT_DISPLAY } from "../design/system/typography";
import { useAuth } from "../features/auth/AuthProvider";
import { Avatar } from "../features/profile/Avatar";
import { FieldEditorSheet } from "../features/profile/FieldEditorSheet";
import {
  PROFILE_FIELDS,
  displayValue,
  type ProfileField,
} from "../features/profile/profileFields";
import { changeProfilePhoto, removeProfilePhoto } from "../features/profile/profilePhoto";
import { saveProfile, useProfile } from "../features/profile/useProfile";
import { useToast } from "../features/toast/ToastProvider";
import { themedStyles, useTheme } from "../theme";

/**
 * My profile — six questions, two columns, nothing else (Taylor, 2026-08-20, final shape).
 * The identity card up top edits IN PLACE (Taylor, 2026-08-24: no second tap into a sheet the
 * golfer already navigated to): the avatar wears a small edit badge and a tap on it goes
 * straight to the photo picker, while the pencil swaps name + region to inline inputs with
 * their own Save / Cancel. Each tile below is one answer, tapped open in its editor sheet. The
 * registry (`profileFields.ts`) decides the six — this screen renders whatever it says and
 * adds nothing of its own.
 */
export function MyProfileScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const t = useTheme();
  const toast = useToast();
  const { firstName } = useAuth();
  const { state } = useProfile();
  const [editing, setEditing] = useState<ProfileField | null>(null);
  const [identityEditing, setIdentityEditing] = useState(false);
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);

  if (state.kind !== "ok") {
    // Loading and unreachable draw the same quiet shell — the tiles arrive when the wire
    // does, and a profile screen has nothing urgent enough to justify an error wall.
    return <View style={styles.root} />;
  }

  const pub = state.profile.public;
  const priv = state.profile.private;

  const changePhoto = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    const outcome = await changeProfilePhoto();
    setPhotoBusy(false);
    if (outcome === "failed") {
      toast({
        id: `avatar-upload-failed-${Date.now()}`,
        title: "Couldn't save your photo",
        detail: "Check your connection and try again.",
        icon: CloudOff,
      });
    } else if (outcome === "denied") {
      toast({
        id: `avatar-photos-denied-${Date.now()}`,
        title: "Photos access is off",
        detail: "Allow photo access in Settings to add a picture.",
        icon: ImageOff,
      });
    }
  };

  const removePhoto = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    const ok = await removeProfilePhoto();
    setPhotoBusy(false);
    if (!ok) {
      toast({
        id: `avatar-remove-failed-${Date.now()}`,
        title: "Couldn't remove your photo",
        detail: "Check your connection and try again.",
        icon: CloudOff,
      });
    }
  };

  const beginIdentityEdit = () => {
    // Seeded on ENTRY, not kept live: the inputs hold the golfer's draft, and a background
    // profile refresh must not rewrite what they are mid-typing.
    setName(pub.displayName || firstName || "");
    setWhere(pub.region ?? "");
    setIdentityEditing(true);
  };

  const saveIdentity = () => {
    const trimmed = name.trim();
    // A blanked name is NOT sent — an account with no display name renders as nothing
    // everywhere it appears, so the old name stands until a new one replaces it.
    saveProfile({
      public: {
        ...(trimmed ? { displayName: trimmed } : {}),
        region: where.trim() ? where.trim() : null,
      },
    }).catch(() => {
      toast({
        id: `identity-save-failed-${Date.now()}`,
        title: "Couldn't save",
        detail: "Check your connection and try again.",
        icon: CloudOff,
      });
    });
    setIdentityEditing(false);
  };

  const photoButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Change your profile photo"
      accessibilityState={{ disabled: photoBusy }}
      testID="profile-photo"
      onPress={() => void changePhoto()}
      hitSlop={6}
      // The press compresses the whole disc — a fill step has nothing to show on a photo.
      style={({ pressed }) => [styles.photoWrap, pressed && styles.photoWrapPressed]}
    >
      <Avatar size={56} />
      <View style={styles.photoBadge}>
        {photoBusy ? (
          <ActivityIndicator size={12} color={t.onDark} />
        ) : (
          <Pencil size={11} color={t.onDark} strokeWidth={2.6} />
        )}
      </View>
    </Pressable>
  );

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {identityEditing ? (
          <View style={[styles.head, styles.headEditing]}>
            <View style={styles.headRow}>
              {photoButton}
              <View style={styles.editFields}>
                <Input
                  label="Name"
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoComplete="name"
                  testID="identity-name"
                />
                <Input
                  label="Where you play"
                  value={where}
                  onChangeText={setWhere}
                  autoCapitalize="words"
                  placeholder="City or region"
                  testID="identity-region"
                />
              </View>
            </View>
            <View style={styles.editActions}>
              {pub.avatarUrl ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove your profile photo"
                  testID="identity-remove-photo"
                  onPress={() => void removePhoto()}
                  style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                >
                  <Text style={[styles.chipLabel, { color: t.bad }]}>Remove photo</Text>
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel editing"
                testID="identity-cancel"
                onPress={() => setIdentityEditing(false)}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
              >
                <Text style={styles.chipLabel}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save name and region"
                testID="identity-save"
                onPress={saveIdentity}
                style={({ pressed }) => [styles.saveChip, pressed && styles.saveChipPressed]}
              >
                <Text style={[styles.chipLabel, { color: t.onDark }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.head}>
            {photoButton}
            <View style={styles.headText}>
              <Text style={styles.headName} numberOfLines={1}>
                {pub.displayName || firstName || "Your account"}
              </Text>
              {pub.region ? (
                <Text style={styles.headMeta} numberOfLines={1}>
                  {pub.region}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit your name and region"
              testID="profile-identity-edit"
              onPress={beginIdentityEdit}
              hitSlop={6}
              style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
            >
              <Pencil size={15} color={t.text} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}

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
  headEditing: { flexDirection: "column", alignItems: "stretch", gap: 12 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  headText: { flex: 1, minWidth: 0, gap: 4 },
  headName: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 17,
    lineHeight: displayLine(17),
  },
  headMeta: { color: t.muted, fontFamily: FONT_BODY.regular, fontSize: 11 },

  photoWrap: { width: 56, height: 56 },
  photoWrapPressed: { transform: [{ scale: 0.94 }] },
  /** The "you can change this" affordance — a cobalt disc riding the avatar's edge. */
  photoBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },

  editButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  editButtonPressed: { backgroundColor: t.surface3 },

  editFields: { flex: 1, minWidth: 0, gap: 8 },
  editActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    justifyContent: "center",
    backgroundColor: t.surface2,
  },
  chipPressed: { backgroundColor: t.surface3 },
  chipLabel: {
    color: t.text,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 9,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  saveChip: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 17,
    justifyContent: "center",
    backgroundColor: t.cobalt,
  },
  saveChipPressed: { backgroundColor: t.cobaltPressed },

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
