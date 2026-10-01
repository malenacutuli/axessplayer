// Root layout: providers (safe area, prefs + consent, auth, services), the first-launch consent prompt,
// and the stack (tabs + the Watch screen). Dark, high contrast. No em dashes.

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../src/state/AuthProvider";
import { PrefsProvider } from "../src/state/PrefsProvider";
import { ServicesProvider } from "../src/state/ServicesProvider";
import { ConsentPrompt } from "../src/ui/ConsentPrompt";
import { colors } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <AuthProvider>
          <ServicesProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.bg },
                headerTintColor: colors.text,
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="watch/[id]" options={{ title: "Watch", headerBackTitle: "Back" }} />
            </Stack>
            <ConsentPrompt />
          </ServicesProvider>
        </AuthProvider>
      </PrefsProvider>
    </SafeAreaProvider>
  );
}
