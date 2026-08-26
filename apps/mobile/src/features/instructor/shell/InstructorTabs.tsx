import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View } from "react-native";

import type { InstructorTabParamList } from "../../../navigation";
import { InstructorHomeScreen } from "./InstructorHomeScreen";
import { InstructorInboxScreen } from "./InstructorInboxScreen";
import { InstructorTabBar } from "./InstructorTabBar";
import { StudentsScreen } from "./StudentsScreen";

/**
 * INSTRUCTOR MODE's shell (architecture §4) — the second face of the `Tabs` route. The root
 * stack above is shared with personal mode; only this navigator, its bar and its menus differ,
 * which is exactly the "different interface, same page components" split Taylor specified.
 * No `InstructorBubble` here on purpose: an instructor cannot have an instructor, and the
 * bubble is the golfer's furniture.
 */
const Tab = createBottomTabNavigator<InstructorTabParamList>();

export function InstructorTabs() {
  return (
    <View style={{ flex: 1 }} pointerEvents="box-none">
      <Tab.Navigator
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <InstructorTabBar {...props} />}
      >
        <Tab.Screen name="InstructorHome" component={InstructorHomeScreen} />
        <Tab.Screen name="Students" component={StudentsScreen} />
        <Tab.Screen name="InstructorInbox" component={InstructorInboxScreen} />
      </Tab.Navigator>
    </View>
  );
}
