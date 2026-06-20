// Guard-free production entry: start the generation HTTP listener unconditionally. Mirrors
// services/recap/src/serve.ts. No em dashes.
import { runServer } from "./server.js";

void runServer();
