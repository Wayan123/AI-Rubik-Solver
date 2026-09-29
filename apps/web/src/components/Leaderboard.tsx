import { formatCost, formatDuration, type LaneState, laneElapsedMs } from "../state.ts";
import { STATUS_LABEL } from "./Lane.tsx";

function rank(lanes: LaneState[], now: number): LaneState[] {
  return [...lanes].sort((a, b) => {
    const sa = a.result?.solved ? 1 : 0;
    const sb = b.result?.solved ? 1 : 0;
    const pa = a.result?.progress ?? -1;
    const pb = b.result?.progress ?? -1;
    return sb - sa || pb - pa || laneElapsedMs(a, now) - laneElapsedMs(b, now);
  });
}

export function Leaderboard({ lanes, now }: { lanes: LaneState[]; now: number }) {
  if (!lanes.length) return null;
  const rows = rank(lanes, now);
  return (
    <section className="panel" aria-labelledby="lb-title">
      <h2 id="lb-title">Leaderboard</h2>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Contestants ranked by solved, then progress, then time</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Contestant</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Time
              </th>
              <th scope="col" className="num">
                Moves
              </th>
              <th scope="col" className="num">
                Best dist.
              </th>
              <th scope="col" className="num">
                Progress
              </th>
              <th scope="col" className="num">
                Turns
              </th>
              <th scope="col" className="num">
                Tokens in/out
              </th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const r = l.result;
              return (
                <tr key={l.config.id}>
                  <td className="num">{i + 1}</td>
                  <th scope="row">
                    {l.config.label}
                    <span className="cell-sub">{l.config.model ?? l.config.adapter}</span>
                  </th>
                  <td>
                    <span className={`badge badge-${l.status}`}>{STATUS_LABEL[l.status] ?? l.status}</span>
                  </td>
                  <td className="num">{formatDuration(laneElapsedMs(l, now))}</td>
                  <td className="num">{l.movesApplied.length}</td>
                  <td className="num">
                    {r ? `${r.bestDistance.exact ? "" : "≤"}${r.bestDistance.value}` : "—"}
                  </td>
                  <td className="num">{r ? `${Math.round(r.progress * 100)}%` : "—"}</td>
                  <td className="num">{l.turns.length}</td>
                  <td className="num">
                    {r && (r.tokensIn || r.tokensOut) ? `${r.tokensIn}/${r.tokensOut}` : "—"}
                  </td>
                  <td>{r?.cost.length ? formatCost(r.cost) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
