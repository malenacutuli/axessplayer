// The resolved runtime config for this build (EXPO_PUBLIC_* inlined by Expo). No em dashes.

import { authConfigured, readExpoEnv, resolveConfig } from "../core/config/env";

export const env = resolveConfig(readExpoEnv());
export const canSignIn = authConfigured(env);
// EXPO_PUBLIC_USE_MOCKS=1 swaps the content client for the in-memory mock (development only).
export const useMocks = process.env.EXPO_PUBLIC_USE_MOCKS === "1";
