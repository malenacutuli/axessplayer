// Account: email + password sign-in (Supabase Auth), sign out, the library placeholder, and the viewer
// settings (analytics consent, captions default). Guests can use everything else in the app. No em dashes.

import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "../../src/state/AuthProvider";
import { usePrefs } from "../../src/state/PrefsProvider";
import { Button } from "../../src/ui/Button";
import { colors, MIN_TOUCH, space, type } from "../../src/ui/theme";

export default function AccountScreen() {
  const auth = useAuth();
  const prefs = usePrefs();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {auth.session ? (
          <View style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              Signed in
            </Text>
            <Text style={styles.body}>{auth.email}</Text>
            <Text style={styles.sub} accessibilityRole="header">
              Library
            </Text>
            <Text style={styles.body}>Your saved videos are coming soon.</Text>
            <Button label="Sign out" onPress={auth.signOut} />
          </View>
        ) : (
          <SignInForm />
        )}

        <View style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            Settings
          </Text>
          <Button
            role="switch"
            checked={prefs.captionsEnabled}
            label={prefs.captionsEnabled ? "Captions on by default" : "Captions off by default"}
            onPress={() => prefs.setCaptionsEnabled(!prefs.captionsEnabled)}
          />
          <Button
            role="switch"
            checked={prefs.consent === "granted"}
            label={prefs.consent === "granted" ? "Anonymous viewing analytics allowed" : "Anonymous viewing analytics off"}
            accessibilityHint="Helps pay creators and improve accessibility. Off unless you allow it."
            onPress={() => prefs.setConsent(prefs.consent === "granted" ? "denied" : "granted")}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SignInForm() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!auth.configured) {
    return (
      <View style={styles.section}>
        <Text style={styles.heading} accessibilityRole="header">
          Sign in
        </Text>
        <Text style={styles.body}>Sign-in is not configured in this build. You can still watch everything.</Text>
      </View>
    );
  }

  async function run(action: "in" | "up") {
    setBusy(true);
    setMessage(null);
    const err = action === "in" ? await auth.signIn(email, password) : await auth.signUp(email, password);
    setBusy(false);
    setMessage(err);
  }

  const canSubmit = email.includes("@") && password.length >= 6 && !busy;

  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        Sign in
      </Text>
      <Text style={styles.body}>Watching is free without an account. Sign in to tip creators and keep a library.</Text>
      <Text style={styles.label} nativeID="emailLabel">
        Email
      </Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Email"
        accessibilityLabelledBy="emailLabel"
        placeholderTextColor={colors.textMuted}
      />
      <Text style={styles.label} nativeID="passwordLabel">
        Password
      </Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        accessibilityLabel="Password"
        accessibilityLabelledBy="passwordLabel"
        onSubmitEditing={() => canSubmit && run("in")}
      />
      {message ? (
        <Text style={styles.message} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {message}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button variant="primary" label={busy ? "Signing in" : "Sign in"} disabled={!canSubmit} onPress={() => run("in")} />
        <Button label="Create account" disabled={!canSubmit} onPress={() => run("up")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xl },
  section: { gap: space.md },
  heading: { ...type.title, color: colors.text },
  sub: { ...type.label, color: colors.text },
  body: { ...type.body, color: colors.textMuted },
  label: { ...type.label, color: colors.text },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: space.md,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 16,
  },
  message: { ...type.body, color: colors.danger },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
