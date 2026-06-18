// Bridges the RealProduceStore (the JOB API CONTRACT store) to the real produce executor: it builds the
// per-variant ports (edge/storage/content) from the runtime config and drives the DAG via runProduceJob.
// The runtime config + the optional fetch are injected so this is testable end to end (a fake fetch / fake
// ports assert the DAG completes on real outputs and registers tracks). No em dashes.

import type { RealStoreRunner, CreateJobInput, ProduceJob } from "./jobsStore.js";
import type { EdgeClient, StoragePort, ContentPort, ProduceVariant } from "./produceExecutor.js";
import { runProduceJob, emptyState } from "./produceExecutor.js";
import { makeEdgeClient, makeStorage, makeContent, type RuntimeConfig } from "./produceRuntime.js";

export interface RunnerPorts {
  edge: EdgeClient;
  storage: StoragePort;
  content: ContentPort;
}

// Build the runner from a set of ports (tests inject fakes; production passes the fetch-backed adapters).
export function makeProduceRunner(ports: RunnerPorts): RealStoreRunner {
  return {
    run: async (job: ProduceJob, input: CreateJobInput): Promise<void> => {
      if (!input.variant) return; // preview-only request: no run
      const variant: ProduceVariant = {
        variantId: input.variant.variantId,
        seriesId: input.seriesId,
        videoUrl: input.variant.videoUrl,
        languages: input.targets.languages,
        signLanguages: input.targets.signLanguages,
      };
      await runProduceJob(job, {
        edge: ports.edge,
        storage: ports.storage,
        content: ports.content,
        variant,
        state: emptyState(),
        budgetUsd: job.estimatedUsd, // the cost-before-commit estimate is the run budget (cost gate)
      });
    },
  };
}

// Build the production runner from the runtime config (the fetch-backed adapters). storagePrefix is set
// per-variant so produced tracks land under a stable folder in the thumbnails bucket.
export function makeProductionRunner(cfg: RuntimeConfig, fetchFn: typeof fetch = fetch): RealStoreRunner {
  return {
    run: async (job: ProduceJob, input: CreateJobInput): Promise<void> => {
      if (!input.variant) return;
      const variantCfg: RuntimeConfig = { ...cfg, storagePrefix: input.variant.variantId };
      const ports: RunnerPorts = {
        edge: makeEdgeClient(variantCfg, fetchFn),
        storage: makeStorage(variantCfg, fetchFn),
        content: makeContent(variantCfg, fetchFn),
      };
      await makeProduceRunner(ports).run(job, input);
    },
  };
}
