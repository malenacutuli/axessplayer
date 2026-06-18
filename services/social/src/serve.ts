// Guard-free container entry point. The package `serve` script points node at this file
// (`node --import tsx src/serve.ts`) so the listener starts UNCONDITIONALLY. Mirrors
// services/identity/src/serve.ts and services/content/src/serve.ts. No em dashes.
import { runServer } from "./server.js";

void runServer();
