/** Inline SVG line of a team's total per round. Gaps (null) break the line; nothing is interpolated. */
export function Sparkline({ rounds, points, label }: { rounds: number[]; points: (number | null)[]; label: string }) {
  const W = 320;
  const H = 72;
  const P = 4;
  const vals = points.filter((p): p is number => p !== null);
  if (vals.length < 2) return <p className="muted">Not enough rounds yet for a chart.</p>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - P - ((v - min) * (H - 2 * P)) / span;
  let d = '';
  let pen = false;
  points.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${label}: ${Math.round(min * 1000) / 1000} to ${Math.round(max * 1000) / 1000} over rounds ${rounds[0]} to ${rounds[rounds.length - 1]}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
