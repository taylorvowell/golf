import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CloudOff } from "lucide-react-native";

import { Input, Sheet } from "../../design/system";
import { FONT_DISPLAY } from "../../design/system/typography";
import { themedStyles } from "../../theme";
import { useToast } from "../toast/ToastProvider";
import { saveProfile } from "./useProfile";

/**
 * The §5.1 public half's editor — name and region, opened by tapping the hub's identity card.
 *
 * Two fields only, on purpose: the avatar comes from the sign-in provider, and bio belongs to
 * the coach directory (§23) — offering it before that surface exists would be collecting a
 * paragraph nothing renders. The one Done applies both fields in one PATCH; empty region
 * clears it, but a blanked name is NOT sent — an account with no display name renders as
 * nothing everywhere it appears, so the old name stands until a new one replaces it.
 */
export function IdentitySheet({
  visible,
  onClose,
  displayName,
  region,
}: {
  visible: boolean;
  onClose: () => void;
  displayName: string;
  region: string | null;
}) {
  const styles = useStyles();
  const toast = useToast();
  const [name, setName] = useState(displayName);
  const [where, setWhere] = useState(region ?? "");

  const done = () => {
    const trimmed = name.trim();
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
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="You" testID="identity-sheet">
      <View style={styles.body}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save name and region"
          testID="identity-done"
          onPress={done}
          style={({ pressed }) => [styles.done, pressed && styles.donePressed]}
        >
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const useStyles = themedStyles((t) => ({
  body: { paddingHorizontal: 16, paddingBottom: 20, gap: 14 },
  done: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    backgroundColor: t.cobalt,
  },
  donePressed: { backgroundColor: t.cobaltPressed },
  doneLabel: {
    color: t.onDark,
    fontFamily: FONT_DISPLAY.black,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
}));
