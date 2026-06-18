// Guard-free container entry point for the ONLINE experiment serving tier (Slice B). Imports and calls
// the exported runServer() so the listener starts UNCONDITIONALLY, mirroring services/content/src/serve.ts
// and services/decision/src/serve.ts. NOT DEPLOYED this wave (absent from render.yaml). No em dashes.
import { runServer } from "./server.js";

void runServer();
