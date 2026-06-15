// Minimal ambient declarations for "react", "react/jsx-runtime", and "react-native" so the screen
// components typecheck in this CI lane WITHOUT installing the native toolchain (react, react-native, expo
// are added at EAS build time, not in the contract/logic CI). These are deliberately small structural
// shims, not the real types: they cover only the surface the screens use, including the JSX runtime so
// `jsx: react-jsx` resolves. At EAS build time the real @types/react and react-native types take over.
// The logic/data/contract layers (everything outside src/screens) do not depend on these. No em dashes.

declare namespace JSX {
  // Permissive element typing: this lane does not validate native element props; the real types do at EAS
  // build time. This keeps the presentation-only screens compiling without the native toolchain.
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [elemName: string]: unknown;
  }
}

declare module "react" {
  export type ReactNode = unknown;
  export type Key = string | number;
  export interface FunctionComponent<P = Record<string, unknown>> {
    (props: P & { key?: Key; children?: ReactNode }): ReactNode;
  }
  export type FC<P = Record<string, unknown>> = FunctionComponent<P>;
  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function createElement(...args: unknown[]): unknown;

  const React: {
    createElement: (...args: unknown[]) => unknown;
  };
  export default React;
}

declare module "react/jsx-runtime" {
  export const jsx: (...args: unknown[]) => unknown;
  export const jsxs: (...args: unknown[]) => unknown;
  export const Fragment: unknown;
}

declare module "react-native" {
  import type { FC, Key, ReactNode } from "react";
  export interface ViewProps {
    key?: Key;
    style?: unknown;
    children?: ReactNode;
    accessible?: boolean;
    accessibilityLabel?: string;
    testID?: string;
  }
  export interface TextProps extends ViewProps {
    numberOfLines?: number;
  }
  export interface PressableProps extends ViewProps {
    onPress?: () => void;
    accessibilityRole?: string;
    disabled?: boolean;
  }
  export interface FlatListProps<T> extends ViewProps {
    data: readonly T[];
    renderItem: (info: { item: T; index: number }) => ReactNode;
    keyExtractor?: (item: T, index: number) => string;
    pagingEnabled?: boolean;
    horizontal?: boolean;
    showsVerticalScrollIndicator?: boolean;
    onViewableItemsChanged?: (info: { viewableItems: { item: T }[] }) => void;
  }
  export const View: FC<ViewProps>;
  export const Text: FC<TextProps>;
  export const Pressable: FC<PressableProps>;
  export function FlatList<T>(props: FlatListProps<T>): ReactNode;
  export const StyleSheet: { create<T extends Record<string, unknown>>(styles: T): T };
}
