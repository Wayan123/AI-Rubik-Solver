import { useMemo, useState } from "react";
import type { DiscoveredHarness, DiscoveredModel, DiscoverySnapshot, HarnessStatus } from "../api.ts";
import { type DiscoveryFilter, filterDiscovery } from "../discovery.ts";

interface Props {
  snapshot: DiscoverySnapshot | null;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onAddModel: (model: DiscoveredModel, harness: DiscoveredHarness) => void;
}

const FILTERS: Array<[DiscoveryFilter, string]> = [
  ["ready", "Ready"],
  ["login-required", "Login required"],
  ["catalog-only", "Catalog only"],
  ["unavailable", "Unavailable"],
  ["discovery-failed", "Discovery failed"],
  ["updates", "Updates"],
];

const STATUS_LABEL: Record<HarnessStatus, string> = {
  ready: "Ready",
  "login-required": "Login required",
  "catalog-only": "Catalog only",
  unavailable: "Unavailable",
  "discovery-failed": "Discovery failed",
  "unsupported-version": "Unsupported version",
};

export function HarnessCatalog({ snapshot, busy, error, onRefresh, onAddModel }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<DiscoveryFilter[]>([]);
  const view = useMemo(
    () => (snapshot ? filterDiscovery(snapshot, query, filters) : null),
    [snapshot, query, filters],
  );

  const toggle = (filter: DiscoveryFilter) =>
    setFilters((current) =>
      current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter],
    );

  return (
    <section className="harness-catalog" aria-labelledby="catalog-title" aria-busy={busy}>
      <div className="catalog-head">
        <div>
          <h3 id="catalog-title">Harnesses &amp; models</h3>
          <p className="hint" aria-live="polite">
            {busy
              ? "Scanning local harnesses and model catalogs…"
              : snapshot?.completedAt
                ? `Last scanned ${new Date(snapshot.completedAt).toLocaleString()}`
                : "Discovery starts with the local runner."}
          </p>
        </div>
        <button type="button" className="btn" onClick={onRefresh} disabled={busy || !snapshot}>
          {busy ? "Scanning…" : "Refresh models"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!snapshot ? (
        <p className="catalog-state">Loading installed harnesses…</p>
      ) : snapshot.state === "failed" ? (
        <p className="catalog-state">Discovery failed. Check the runner log, then refresh.</p>
      ) : (
        <>
          <label className="field catalog-search">
            <span>Find a harness, provider or model</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
          </label>
          <fieldset className="catalog-filters">
            <legend className="sr-only">Filter harness catalog</legend>
            {FILTERS.map(([value, label]) => (
              <button
                type="button"
                className={`filter-btn${filters.includes(value) ? " active" : ""}`}
                aria-pressed={filters.includes(value)}
                key={value}
                onClick={() => toggle(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {view?.harnesses.length ? (
            <div className="harness-list">
              {view.harnesses.map((harness) => {
                const environment = snapshot.environments.find((item) => item.id === harness.environmentId);
                const models = view.models.filter((model) => model.harnessInstanceId === harness.instanceId);
                return (
                  <article className="harness-item" key={harness.instanceId}>
                    <div className="harness-title">
                      <div>
                        <h4>{harness.displayName}</h4>
                        <p>
                          {environment?.label ?? harness.environmentId} · {harness.surface}
                          {harness.version ? ` · ${harness.version}` : ""}
                        </p>
                      </div>
                      <span className={`badge badge-${harness.status}`}>{STATUS_LABEL[harness.status]}</span>
                    </div>
                    {harness.update && (
                      <p className="update-note">
                        Update {harness.update.latest} available.{" "}
                        <a href={harness.update.releaseUrl} target="_blank" rel="noreferrer">
                          Official release
                        </a>
                      </p>
                    )}
                    {models.length > 0 && (
                      <ul className="model-list">
                        {models.map((model) => (
                          <li key={model.routeId}>
                            <code>{model.modelId}</code>
                            {model.selectable && (
                              <button
                                type="button"
                                className="btn model-add"
                                onClick={() => onAddModel(model, harness)}
                              >
                                Add contestant
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {models.length === 0 && (
                      <p className="hint">No model list is available through a safe passive probe.</p>
                    )}
                    <a
                      className="catalog-doc"
                      href={harness.documentationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Official documentation
                    </a>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="catalog-state">No harness or model matches these filters.</p>
          )}
        </>
      )}
    </section>
  );
}
