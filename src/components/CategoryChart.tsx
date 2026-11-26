import { useState } from 'react';
import { BarChart3, PieChart } from 'lucide-react';
import { formatCentsBRL } from '../domain/money';

interface CategoryItem {
  category: string;
  cents: number;
}

interface CategoryChartProps {
  items: readonly CategoryItem[];
  totalExpenseCents: number;
}

// Usa exclusivamente a paleta já existente no sistema (sem alterar cores do tema)
const SLICE_COLORS = [
  '#141619',
  '#C84B31',
  '#24567A',
  '#B87314',
  '#0F6E56',
  '#525964',
  '#7B8390',
];

export function CategoryChart({ items, totalExpenseCents }: CategoryChartProps) {
  const [mode, setMode] = useState<'pie' | 'bars'>('pie');

  if (items.length === 0) {
    return <p className="section-desc">Nenhuma despesa registrada neste mês.</p>;
  }

  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  let cumulativeRatio = 0;

  const slices = items.map((item, idx) => {
    const ratio = totalExpenseCents > 0 ? item.cents / totalExpenseCents : 0;
    const pct = Math.round(ratio * 100);
    const dashLength = ratio * circumference;
    const dashOffset = -cumulativeRatio * circumference;
    cumulativeRatio += ratio;
    return {
      ...item,
      pct,
      color: SLICE_COLORS[idx % SLICE_COLORS.length],
      dashLength,
      dashOffset,
    };
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            className={`chip-toggle ${mode === 'pie' ? 'active' : ''}`}
            onClick={() => setMode('pie')}
          >
            <PieChart size={14} />
            Pizza
          </button>
          <button
            type="button"
            className={`chip-toggle ${mode === 'bars' ? 'active' : ''}`}
            onClick={() => setMode('bars')}
          >
            <BarChart3 size={14} />
            Barras
          </button>
        </div>
        <span className="section-desc">{items.length} categoria(s) no mês</span>
      </div>

      {mode === 'pie' ? (
        <div className="pie-layout anim-fade-in">
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <svg
              viewBox="0 0 180 180"
              style={{ width: 176, height: 176 }}
              role="img"
              aria-label="Gráfico em pizza de despesas por categoria"
            >
              <circle
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke="var(--bg-subtle)"
                strokeWidth="24"
              />
              <g transform="rotate(-90 90 90)">
                {slices.map((slice) => (
                  <circle
                    key={slice.category}
                    cx="90"
                    cy="90"
                    r={radius}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth="24"
                    strokeDasharray={`${slice.dashLength} ${circumference}`}
                    strokeDashoffset={slice.dashOffset}
                  >
                    <title>{`${slice.category}: ${formatCentsBRL(slice.cents)} (${slice.pct}%)`}</title>
                  </circle>
                ))}
              </g>
              <text
                x="90"
                y="84"
                textAnchor="middle"
                fontSize="10.5"
                fontWeight="600"
                fill="#7B8390"
              >
                Total do mês
              </text>
              <text
                x="90"
                y="102"
                textAnchor="middle"
                fontSize="12.5"
                fontWeight="700"
                fill="#141619"
                className="mono"
              >
                {formatCentsBRL(totalExpenseCents)}
              </text>
            </svg>
          </div>

          <div className="list-stack" style={{ flex: 1 }}>
            {slices.map((slice) => (
              <div key={slice.category} className="list-row" style={{ padding: '9px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: slice.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{slice.category}</span>
                </div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                  {formatCentsBRL(slice.cents)}{' '}
                  <span style={{ color: 'var(--ink-muted)' }}>({slice.pct}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid-3 anim-fade-in">
          {slices.map((item) => (
            <div key={item.category} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <span style={{ fontWeight: 600 }}>{item.category}</span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {formatCentsBRL(item.cents)} <span style={{ color: 'var(--ink-muted)' }}>({item.pct}%)</span>
                </span>
              </div>
              <div className="progress-track-light">
                <div className="progress-fill-dark" style={{ width: `${Math.max(4, item.pct)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
