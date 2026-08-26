import { useState } from "react";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { View } from "react-native";
import { House, MessageSquare, User, Users } from "lucide-react-native";

import { WaveNav, type WaveNavItem } from "../../../design/system";
import { useNavVisibility } from "../../../design/system/navVisibility";
import { BroadcastButton } from "./BroadcastButton";
import { BroadcastComposer } from "./BroadcastComposer";

/**
 * The instructor shell's bottom bar — the same `WaveNav`, different doors (architecture §4a):
 * Home and Students left, Inbox and Profile right, **Broadcast** raised in the middle where
 * the golfer bar raises Record. Profile is a door to the root Profile drawer, not a tab —
 * exactly the relationship Record has to the capture surface on the golfer bar.
 *
 * The broadcast composer is step 04's; until then the centre opens a named placeholder sheet
 * rather than doing nothing — a door that silently ignores a tap reads as broken.
 */

const LABELS: Record<string, string> = {
  InstructorHome: "Home",
  Students: "Students",
  InstructorInbox: "Inbox",
};

const ICON_SIZE = 21;

function icon(route: string): WaveNavItem["icon"] {
  switch (route) {
    case "InstructorHome":
      return (color) => <House size={ICON_SIZE} color={color} strokeWidth={2.2} />;
    case "Students":
      return (color) => <Users size={ICON_SIZE} color={color} strokeWidth={2.2} />;
    default:
      return (color) => <MessageSquare size={ICON_SIZE} color={color} strokeWidth={2.2} />;
  }
}

export function InstructorTabBar({ state, navigation }: BottomTabBarProps) {
  const { hidden } = useNavVisibility();
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const tabs: WaveNavItem[] = state.routes.map((route, index) => ({
    key: route.key,
    label: LABELS[route.name] ?? route.name,
    icon: icon(route.name),
    active: state.index === index,
    testID: `tab-${route.name}`,
    onPress: () => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });
      if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
    },
  }));

  const items: WaveNavItem[] = [
    ...tabs,
    {
      key: "instructor-profile",
      label: "Profile",
      icon: (color) => <User size={ICON_SIZE} color={color} strokeWidth={2.2} />,
      active: false,
      testID: "tab-InstructorProfile",
      onPress: () => navigation.navigate("Profile" as never),
    },
  ];

  return (
    <View style={{ height: 0 }}>
      <WaveNav
        items={items}
        hidden={hidden}
        onRecord={() => undefined}
        centerSlot={<BroadcastButton onPress={() => setBroadcastOpen(true)} />}
      />
      <BroadcastComposer visible={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </View>
  );
}

