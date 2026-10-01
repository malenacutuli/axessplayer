// Accessible button: real button role, required label, 48 dp minimum target, visible pressed state.
// No em dashes.

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

import { colors, MIN_TOUCH, space, type } from "./theme";

export interface ButtonProps {
  label: string;
  onPress(): void;
  accessibilityHint?: string;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  role?: "button" | "switch" | "radio" | "link";
  checked?: boolean;
}

export function Button({ label, onPress, accessibilityHint, variant = "secondary", disabled, selected, style, children, role = "button", checked }: ButtonProps) {
  const state = role === "switch" || role === "radio" ? { checked: !!checked, disabled: !!disabled } : { disabled: !!disabled, selected: !!selected };
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={state}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "ghost" && styles.ghost,
        (selected || checked) && styles.selected,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {children ?? (
        <Text style={[styles.text, variant === "primary" && styles.primaryText, (selected || checked) && styles.primaryText]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: 24,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  ghost: { backgroundColor: colors.scrim, borderColor: "transparent" },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  text: { ...type.label, color: colors.text, textAlign: "center" },
  primaryText: { color: colors.accentText },
});
