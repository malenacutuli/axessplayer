// Public surface of the library HTTP adapter. Wire createLibraryApp with a node-postgres PgLibraryDb in
// production, or a fake-pg LibraryDB in tests, plus a session verifier. The adapter is a thin transport
// over the pure library handlers and owns no business logic beyond the auth trust boundary. No em dashes.

export { createLibraryApp, type AppDeps } from "./app.js";
export {
  parseBearer,
  testVerifiers,
  testSessionVerifier,
  type Verifiers,
  type SessionVerifier,
  type SessionIdentity,
} from "./auth.js";
