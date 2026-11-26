import { useState } from 'react';
import { BarChart3, PieChart, X } from 'lucide-react';
import { formatCentsBRL } from '../domain/money';
import { usePersistedState } from '../hooks/usePersistedState';
import { AnimatedCurrency } from './AnimatedCurrency';

interface CategoryItem {
  category: string;
  cents: number;
}

interface CategoryChartProps {
  items: readonly CategoryItem[];
  totalExpenseCents: number;
}

const SLICE_COLORS = [
  '#141619',
  '#C84B31',
  '#24567A',
  '#B87314',
  '#0F6E56',
  '#525964',
  '#5E6673',
];

export function CategoryChart({ items, totalExpenseCents }: CategoryChartProps) {
  const [mode, setMode] = usePersistedState<'pie' | 'bars'>('superfinance_category_mode_v1', 'pie');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

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

  const activeSlice = slices.find((s) => s.category === selectedCategory) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
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

      {/* Balão informativo interativo para Pizza e Barras */}
      {activeSlice ? (
        <div className="chart-tooltip-balloon" role="status" aria-live="polite">
          <div className="chart-tooltip-content">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: activeSlice.color,
                flexShrink: 0,
              }}
            />
            <strong>{activeSlice.category}</strong>
            <span className="mono text-terracotta" style={{ fontWeight: 700 }}>
              {formatCentsBRL(activeSlice.cents)}
            </span>
            <span className="tag tag-navy mono">{activeSlice.pct}% do total do mês</span>
          </div>
          <button
            type="button"
            className="info-balloon-close"
            aria-label="Fechar balão da categoria"
            onClick={() => setSelectedCategory(null)}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <p className="chart-hint">Toque ou passe o mouse em uma fatia ou barra para abrir o balão de detalhes.</p>
      )}

      {mode === 'pie' ? (
        <div key={`pie-${totalExpenseCents}`} className="pie-layout anim-fade-in">
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
              <g className="chart-pie-reveal" transform="rotate(-90 90 90)">
                {slices.map((slice) => {
                  const isActive = selectedCategory === slice.category;
                  return (
                    <circle
                      key={slice.category}
                      className="chart-slice-anim"
                      cx="90"
                      cy="90"
                      r={radius}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={isActive ? 29 : 24}
                      strokeDasharray={`${slice.dashLength} ${circumference}`}
                      strokeDashoffset={slice.dashOffset}
                      style={{ cursor: 'pointer', transition: 'stroke-width 0.2s ease, opacity 0.2s ease' }}
                      opacity={selectedCategory && !isActive ? 0.55 : 1}
                      onMouseEnter={() => setSelectedCategory(slice.category)}
                      onClick={() =>
                        setSelectedCategory((prev) => (prev === slice.category ? null : slice.category))
                      }
                    />
                  );
                })}
              </g>
              <text
                x="90"
                y="84"
                textAnchor="middle"
                fontSize="10.5"
                fontWeight="600"
                fill="#5e6673"
              >
                {activeSlice ? activeSlice.category.slice(0, 14) : 'Total do mês'}
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
                {formatCentsBRL(activeSlice ? activeSlice.cents : totalExpenseCents)}
              </text>
            </svg>
          </div>

          <div className="list-stack" style={{ flex: 1 }}>
            {slices.map((slice, idx) => {
              const isActive = selectedCategory === slice.category;
              return (
                <button
                  key={slice.category}
                  type="button"
                  className={`list-row stagger-item category-legend-btn ${isActive ? 'active' : ''}`}
                  style={{ animationDelay: `${idx * 60}ms` }}
                  onMouseEnter={() => setSelectedCategory(slice.category)}
                  onClick={() =>
                    setSelectedCategory((prev) => (prev === slice.category ? null : slice.category))
                  }
                >
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
                    <AnimatedCurrency cents={slice.cents} mode="count" durationMs={750} />{' '}
                    <span style={{ color: 'var(--ink-muted)' }}>({slice.pct}%)</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div key={`bars-${totalExpenseCents}`} className="grid-3 anim-fade-in">
          {slices.map((item, idx) => {
            const isActive = selectedCategory === item.category;
            return (
              <button
                key={item.category}
                type="button"
                className={`stagger-item category-bar-card ${isActive ? 'active' : ''}`}
                style={{ animationDelay: `${idx * 70}ms` }}
                onMouseEnter={() => setSelectedCategory(item.category)}
                onClick={() =>
                  setSelectedCategory((prev) => (prev === item.category ? null : item.category))
                }
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, width: '100%' }}>
                  <span style={{ fontWeight: 600 }}>{item.category}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    <AnimatedCurrency cents={item.cents} mode="count" durationMs={750} />{' '}
                    <span style={{ color: 'var(--ink-muted)' }}>({item.pct}%)</span>
                  </span>
                </div>
                <div className="progress-track-light">
                  <div
                    className="progress-fill-dark progress-bar-anim"
                    style={{
                      width: `${Math.max(4, item.pct)}%`,
                      backgroundColor: item.color,
                      animationDelay: `${idx * 80}ms`,
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
