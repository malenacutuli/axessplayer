// Public surface of the economy HTTP adapter. Wire createEconomyApp with a service-role EconomyDB
// (PgEconomyDb) and a real session/service verifier in production. The test verifiers are exported for
// tests and local wiring only; they do not verify token signatures. No em dashes.

export { createEconomyApp, type AppDeps } from "./app.js";
export {
  parseBearer,
  testVerifiers,
  testSessionVerifier,
  testServiceVerifier,
  type Verifiers,
  type SessionVerifier,
  type ServiceVerifier,
  type SessionIdentity,
} from "./auth.js";
