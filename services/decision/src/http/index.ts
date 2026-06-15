// Public surface of the decision HTTP adapter. Wire createDecisionApp with the real engine deps
// (Postgres/KV/logger/cohorts) and a real session verifier in production. The test verifier is exported
// for tests and local wiring only; it does not verify token signatures. No em dashes.

export { createDecisionApp, type AppDeps } from "./app.js";
export {
  parseBearer,
  testVerifiers,
  testSessionVerifier,
  type Verifiers,
  type SessionVerifier,
  type SessionIdentity,
} from "./auth.js";
