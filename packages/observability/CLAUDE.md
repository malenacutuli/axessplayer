# observability : package instructions

**Owner workstream: WD (observability).** Stack: framework-agnostic TypeScript, ESM, Web standard
types. Dependency-free.

You may write only inside this package. Do not edit services this pass; services adopt this package
later. Never edit `contracts/`. No em dashes.

Scope: structured JSON logging, a metrics interface with an in-memory default and a flagged exporter
seam (no live Prometheus/OTel wiring), trace-context propagation across the fetch boundary, and a
uniform health/readiness handler factory for `/healthz` and `/readyz`.

Real vs flagged: logging and in-memory metrics are real; the `MetricsExporter` seam is an interface
only. Do not bind a live exporter here; W11/deploy or the adopting service does that.

See README.md for the service adoption guide.
