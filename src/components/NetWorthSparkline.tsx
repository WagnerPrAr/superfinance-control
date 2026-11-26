import { shiftYearMonth } from '../domain/ledger';
import { subtractCents, sumCents } from '../domain/money';
import type { Transaction } from '../domain/types';

interface NetWorthSparklineProps {
  transactions: readonly Transaction[];
  currentYearMonth: string;
  baseNetWorthCents: number;
}

export function NetWorthSparkline({
  transactions,
  currentYearMonth,
  baseNetWorthCents,
}: NetWorthSparklineProps) {
  const months = [-5, -4, -3, -2, -1, 0].map((delta) => shiftYearMonth(currentYearMonth, delta));

  // Constrói evolução relativa dos últimos 6 meses até o patrimônio atual
  const monthlyNets = months.map((ym) => {
    const txs = transactions.filter((t) => t.competenceDate.startsWith(ym) && t.type !== 'transfer');
    const inc = sumCents(txs.filter((t) => t.type === 'income').map((t) => t.amountCents));
    const exp = sumCents(txs.filter((t) => t.type === 'expense').map((t) => t.amountCents));
    return subtractCents(inc, exp);
  });

  const pointsValues: number[] = [];
  let running = baseNetWorthCents;
  for (let i = monthlyNets.length - 1; i >= 0; i--) {
    pointsValues.unshift(running);
    running = subtractCents(running, monthlyNets[i]);
  }

  const min = Math.min(...pointsValues);
  const max = Math.max(...pointsValues);
  const span = Math.max(10000, max - min);

  const pts = pointsValues.map((val, idx) => ({
    x: 8 + idx * 28,
    y: 44 - Math.round(((val - min) / span) * 32),
  }));

  let lineD = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cx = (pts[i].x + pts[i + 1].x) / 2;
    lineD += ` C ${cx} ${pts[i].y}, ${cx} ${pts[i + 1].y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  const areaD = `${lineD} L ${pts[pts.length - 1].x} 52 L ${pts[0].x} 52 Z`;
  const last = pts[pts.length - 1];

  return (
    <svg
      key={`${currentYearMonth}-${baseNetWorthCents}`}
      viewBox="0 0 156 54"
      className="bento-sparkline"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sf-spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sf-spark-grad)" className="chart-area-fade" />
      <path
        d={lineD}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="chart-curve-draw"
        pathLength={100}
      />
      <circle cx={last.x} cy={last.y} r="3.8" fill="currentColor" className="chart-dot-pop" />
    </svg>
  );
}
