// Public surface of the content HTTP adapter. Wire createContentApp with a node-postgres ContentDB
// (PgContentDb) in production, or a PGlite-backed ContentDB in tests. The adapter is a thin transport
// over the content handlers and owns no business logic. No em dashes.

export { createContentApp, type AppDeps } from "./app.js";
