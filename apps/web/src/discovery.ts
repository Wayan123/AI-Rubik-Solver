import type { ContestantConfig } from "@rubik-arena/bench-core";
import type { DiscoveredHarness, DiscoveredModel, DiscoverySnapshot, HarnessStatus } from "./api.ts";

export type DiscoveryFilter = HarnessStatus | "updates";

export interface DiscoveryView {
  environments: DiscoverySnapshot["environments"];
  harnesses: DiscoveredHarness[];
  models: DiscoveredModel[];
}

export function filterDiscovery(
  snapshot: DiscoverySnapshot,
  query: string,
  filters: readonly DiscoveryFilter[],
): DiscoveryView {
  const needle = query.trim().toLowerCase();
  const modelMatches = new Set(
    snapshot.models
      .filter((model) =>
        [model.modelId, model.provider, model.displayName].some((value) =>
          value?.toLowerCase().includes(needle),
        ),
      )
      .map((model) => model.harnessInstanceId),
  );
  const harnesses = snapshot.harnesses.filter((harness) => {
    const statusMatch =
      filters.length === 0 ||
      filters.some((filter) => (filter === "updates" ? Boolean(harness.update) : harness.status === filter));
    const textMatch =
      !needle ||
      harness.displayName.toLowerCase().includes(needle) ||
      harness.harnessId.toLowerCase().includes(needle) ||
      modelMatches.has(harness.instanceId);
    return statusMatch && textMatch;
  });
  const ids = new Set(harnesses.map((harness) => harness.instanceId));
  const models = snapshot.models.filter((model) => {
    if (!ids.has(model.harnessInstanceId)) return false;
    return (
      !needle ||
      [model.modelId, model.provider, model.displayName].some((value) =>
        value?.toLowerCase().includes(needle),
      ) ||
      harnesses.some(
        (harness) =>
          harness.instanceId === model.harnessInstanceId &&
          (harness.displayName.toLowerCase().includes(needle) || harness.harnessId.includes(needle)),
      )
    );
  });
  return { environments: snapshot.environments, harnesses, models };
}

export function contestantFromDiscoveredModel(
  model: DiscoveredModel,
  harness: DiscoveredHarness,
  id: string,
): ContestantConfig {
  if (!model.selectable || !model.adapterId || harness.supportLevel !== "verified-runnable") {
    throw new Error("discovered model is not selectable");
  }
  const short = model.modelId.includes("/") ? model.modelId.split("/").at(-1)! : model.modelId;
  return {
    id,
    label: `${short} (${harness.displayName})`,
    adapter: model.adapterId,
    model: model.modelId,
    mode: "interactive",
    maxTurns: 30,
    maxMovesPerTurn: 10,
    requestTimeoutMs: 600_000,
    runTimeoutMs: 1_800_000,
  };
}

export function isContestantStale(contestant: ContestantConfig, snapshot: DiscoverySnapshot | null): boolean {
  if (!snapshot || !contestant.model) return false;
  const relevant = snapshot.harnesses.filter((harness) => harness.adapterId === contestant.adapter);
  if (!relevant.length || relevant.every((harness) => harness.modelDiscovery === "none")) return false;
  return !snapshot.models.some(
    (model) => model.adapterId === contestant.adapter && model.modelId === contestant.model,
  );
}
