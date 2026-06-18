// Guard-free container entry point for the brand revenue-rail service. Mirrors services/economy/src/
// serve.ts: the package `serve` script points node at this file so the listener starts unconditionally.
//
// PRODUCTION CUTOVER GATE (flagged, not faked): real advertiser/operator token verification (JWT signature,
// JWKS rotation, issuer/audience, expiry) is NOT implemented; auth.ts ships TEST verifiers only. Under
// NODE_ENV=production selectVerifiers throws, a deliberate hard stop so an unverified token scheme can
// never run live brand fills or post billing entries. Inject a real Verifiers before going production.
//
// Stripe stays TEST: this service only posts double-entry LEDGER entries; it never touches a live card
// rail. The CONTENT/AD firewall is structural: the service only ever talks to the BrandDB (brand-plane
// tables). No em dashes.

import { createBrandServer } from "./server.js";
import { createInMemoryBrandDB, type BrandDB } from "./store.js";
import { createStubDemandAdapter, assertNoVisionCapability } from "./demand.js";
import { testVerifiers, type Verifiers } from "./auth.js";

function selectVerifiers(): Verifiers {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "brand server: real advertiser/operator JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real Verifiers before running with NODE_ENV=production",
    );
  }
  const secret =
    process.env.BRAND_OPERATOR_SECRET && process.env.BRAND_OPERATOR_SECRET.length > 0
      ? process.env.BRAND_OPERATOR_SECRET
      : "dev-operator-secret";
  return testVerifiers(secret);
}

// The production store is the pg-backed BrandDB (PgBrandDb over a node-postgres Pool with
// search_path=mobile). It is loaded lazily so the test/local in-memory path needs no pg install. When
// DATABASE_URL is absent (local/dev), the in-memory store backs the service.
async function selectStore(): Promise<BrandDB> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.length === 0) return createInMemoryBrandDB();
  const [{ default: pg }, { PgBrandDb }] = await Promise.all([import("pg"), import("./pgBrandDb.js")]);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ...(process.env.DB_OPTIONS ? { options: process.env.DB_OPTIONS } : {}),
  });
  return new PgBrandDb(pool);
}

async function run(): Promise<void> {
  try {
    const verifiers = selectVerifiers();
    const db = await selectStore();
    const demand = createStubDemandAdapter();
    assertNoVisionCapability(demand); // license-not-build invariant: the demand rail exposes no CV capability
    const port = Number(process.env.PORT ?? 8104);
    const host = process.env.HOST ?? "0.0.0.0";
    createBrandServer({ db, verifiers, demand }).listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.log(`brand revenue-rail service listening on ${host}:${port} (Stripe TEST mode only, content/ad firewall on)`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start brand server", err);
    process.exitCode = 1;
  }
}

void run();
