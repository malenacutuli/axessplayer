// Guard-free container entry point. The package `serve` script points node at this file
// (`node --import tsx src/serve.ts`) so the listener starts UNCONDITIONALLY. The old is-main guard in
// server.ts evaluated FALSE under that CMD and the listener never started; this file removes the guard by
// just importing and calling the exported runServer(). No em dashes.
import { runServer } from "./server.js";

void runServer();
