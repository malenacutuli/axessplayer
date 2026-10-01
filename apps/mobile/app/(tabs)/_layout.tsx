// Bottom tabs: Home (Netflix-like rows), Shorts (TikTok-like feed), Account. Text labels are always shown
// so the tabs read clearly at any font size and with a screen reader. No em dashes.

import { Tabs } from "expo-router";

import { colors } from "../../src/ui/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
        tabBarIconStyle: { display: "none" },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarAccessibilityLabel: "Home" }} />
      <Tabs.Screen name="shorts" options={{ title: "Shorts", headerShown: false, tabBarAccessibilityLabel: "Shorts" }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarAccessibilityLabel: "Account" }} />
    </Tabs>
  );
}
