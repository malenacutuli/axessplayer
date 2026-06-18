// Guard-free entry: the `serve` script points node at this file, which unconditionally starts the listener.
// Mirrors services/adaptation/src/serve.ts (an is-main guard evaluates FALSE under
// `node --import tsx src/...`, so a dedicated no-guard entry makes startup deterministic). No em dashes.

import { runServer } from "./httpServer.js";

void runServer();
