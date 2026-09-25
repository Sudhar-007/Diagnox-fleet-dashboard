import ProvenanceBadge from './ProvenanceBadge.jsx';
import { FIELD_LABEL } from '../lib/fields.js';
import { formatDuration } from '../lib/format.js';

const pct = (x) => `${Math.round(x * 100)} %`;

// Rule score next to the ML score, and exactly which readings earned which points.
export default function RiskPanel({ truck }) {
  const breakdown = truck.risk_breakdown ?? [];
  const ml = truck.maintenance_risk_score;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            Rule score <ProvenanceBadge kind="RULE_BASED" />
          </div>
          <div className="mt-1 font-cond text-4xl font-bold leading-none">
            {truck.rule_risk_score ?? 0}
            <span className="ml-1 text-lg font-medium text-muted">/ 100</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            ML score {typeof ml === 'number' && <ProvenanceBadge kind={truck.provenance} />}
          </div>
          {typeof ml === 'number' ? (
            <div className="mt-1 font-cond text-4xl font-bold leading-none">
              {ml}
              <span className="ml-1 text-lg font-medium text-muted">/ 100</span>
            </div>
          ) : (
            <p className="mt-2 text-[15px] text-muted">ML model: not connected</p>
          )}
        </div>
      </div>

      <p className="max-w-[72ch] text-sm text-muted">
        Last 10 minutes. For each reading past its warning threshold: points = weight × share of time past the
        threshold × (0.5 + 0.5 × how far past, as a share of the way to critical). Weights and thresholds are
        demo-tuned values in rules.js.
      </p>

      {breakdown.length === 0 ? (
        <p className="text-[15px] text-muted">Nothing has been past a warning threshold in the last 10 minutes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-2 pr-4 font-normal">Reading</th>
                <th className="py-2 pr-4 font-normal">Rule</th>
                <th className="py-2 pr-4 font-normal">Time past warning</th>
                <th className="py-2 pr-4 font-normal">How far past</th>
                <th className="py-2 pr-4 font-normal">Weight</th>
                <th className="py-2 font-normal text-right">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {breakdown.map((b) => (
                <tr key={b.field}>
                  <td className="py-2 pr-4 text-ink">
                    {FIELD_LABEL[b.field] ?? b.field}
                    <div className="text-muted">{b.field}</div>
                  </td>
                  <td className="py-2 pr-4 text-muted">
                    {b.rule_name} ({b.op} {b.threshold} {b.unit})
                  </td>
                  <td className="py-2 pr-4 text-ink">
                    {pct(b.exposure)} <span className="text-muted">({formatDuration(b.breach_s)})</span>
                  </td>
                  <td className="py-2 pr-4 text-ink">
                    {pct(b.intensity)}{' '}
                    <span className="text-muted">
                      (worst {b.worst_value} {b.unit})
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted">{b.weight}</td>
                  <td className="py-2 text-right font-semibold text-ink">{b.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
