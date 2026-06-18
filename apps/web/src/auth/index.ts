// Public surface of the 20-V0 auth module. Import the styles once (auth.css) in the app entry alongside
// the existing brand tokens and design-system tokens. No em dashes.

export { AuthProvider, useAuth } from "./AuthProvider.js";
export type { AuthApi, AuthState, AuthPhase } from "./AuthProvider.js";
export { SignIn } from "./SignIn.js";
export { CreateProfile } from "./CreateProfile.js";
export { SignInPrompt } from "./SignInPrompt.js";
export { getSupabase, isAuthConfigured } from "./supabaseClient.js";
export { createIdentityClient, IdentityError } from "./identityApi.js";
export type { IdentityClient, IdentityUser, VerifyResult } from "./identityApi.js";
export { createAuthAnalytics } from "./authAnalytics.js";
export type { AuthAnalytics, AuthBreadcrumb, AuthStep, AuthMethod, CanonicalEmitter } from "./authAnalytics.js";
