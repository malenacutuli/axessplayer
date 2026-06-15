// Public surface of the trust service. Provenance (C2PA, TEST signer for now) and the tamper-evident
// consent ledger, plus the Postgres adapter. No em dashes.

export { TrustService } from "./trust.js";
export type {
  TrustDB,
  CredentialRow,
  ConsentInput,
  ConsentRow,
  VerifyResult,
} from "./trust.js";
export { PgTrustDb } from "./pgTrustDb.js";
export type { QueryClient } from "./pgTrustDb.js";
export {
  signManifest,
  verifyManifest,
  TEST_SIGNER_LABEL,
  type C2paClaim,
  type SignedC2paManifest,
} from "./c2pa.js";
export {
  computeRowHash,
  verifyChain,
  GENESIS_PREV_HASH,
  type ConsentContent,
  type ChainRow,
  type ChainCheck,
} from "./hashChain.js";
