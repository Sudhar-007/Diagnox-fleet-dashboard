import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { themeColor } from '../lib/theme.js';

function Tip({ active, payload, unit, digits }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-[4px] border border-line bg-panel-hi px-2 py-1 text-xs">
      <span className="text-ink">
        {p.v.toFixed(digits)} {unit}
      </span>
      <span className="ml-2 text-muted">{p.ts.slice(11)}</span>
    </div>
  );
}

// One series, thin neutral line; dashed rules mark the warning / critical thresholds
// (labelled, so the state is never carried by colour alone). Hover shows value + time.
export default function Sparkline({ points, field, unit, digits = 0, rules = [], label }) {
  const data = points
    .filter((p) => typeof p[field] === 'number')
    .map((p) => ({ t: new Date(p.timestamp).getTime(), ts: p.timestamp, v: p[field] }));

  if (data.length < 2) {
    return <p className="flex h-20 items-center text-sm text-muted">Collecting data for the 5-minute trend.</p>;
  }

  const values = data.map((d) => d.v);
  const lines = rules.filter((r) => r.field === field);
  const all = [...values, ...lines.map((r) => r.threshold)];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;

  return (
    <div className="h-20" role="img" aria-label={`${label}, last 5 minutes, from ${Math.min(...values)} to ${Math.max(...values)} ${unit}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 58, bottom: 0, left: 0 }}>
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis domain={[lo - pad, hi + pad]} hide />
          {lines.map((r) => (
            <ReferenceLine
              key={r.id}
              y={r.threshold}
              stroke={themeColor(r.level === 'critical' ? 'crit' : 'warn')}
              strokeDasharray="3 3"
              strokeOpacity={0.7}
              label={{ value: `${r.level === 'critical' ? 'crit' : 'warn'} ${r.threshold}`, position: 'right', fill: themeColor('muted'), fontSize: 10 }}
            />
          ))}
          <Tooltip
            content={<Tip unit={unit} digits={digits} />}
            cursor={{ stroke: themeColor('muted'), strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line type="monotone" dataKey="v" stroke={themeColor('ink')} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
