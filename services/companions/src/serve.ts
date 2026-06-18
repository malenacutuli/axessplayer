// Guard-free container entry point. The package `serve` script points node at this file
// (`node --import tsx src/serve.ts`) so the listener starts UNCONDITIONALLY. Mirrors
// services/identity-performance/src/serve.ts. selectVerifiers still throws under NODE_ENV=production, so the
// cutover hard stop is preserved. No em dashes.
import { runServer } from "./server.js";

void runServer();
