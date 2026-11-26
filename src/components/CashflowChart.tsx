import { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, TrendingUp, X } from 'lucide-react';
import { shiftYearMonth } from '../domain/ledger';
import { formatCentsBRL, subtractCents, sumCents } from '../domain/money';
import type { Transaction } from '../domain/types';
import { usePersistedState } from '../hooks/usePersistedState';

interface CashflowChartProps {
  transactions: readonly Transaction[];
  currentYearMonth: string;
}

type ChartMode = 'bars' | 'curves';

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function buildSmoothCurvePath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

export function CashflowChart({ transactions, currentYearMonth }: CashflowChartProps) {
  const [mode, setMode] = usePersistedState<ChartMode>('superfinance_cashflow_mode_v1', 'bars');
  const [activeYm, setActiveYm] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const months = [-4, -3, -2, -1, 0, 1].map((delta) => shiftYearMonth(currentYearMonth, delta));

  const series = months.map((ym) => {
    const monthTxs = transactions.filter((tx) => tx.competenceDate.startsWith(ym) && tx.type !== 'transfer');
    const incomeTxs = monthTxs.filter((tx) => tx.type === 'income');
    const expenseTxs = monthTxs.filter((tx) => tx.type === 'expense');
    const incomeCents = sumCents(incomeTxs.map((tx) => tx.amountCents));
    const expenseCents = sumCents(expenseTxs.map((tx) => tx.amountCents));
    const netCents = subtractCents(incomeCents, expenseCents);
    const monthIdx = Number(ym.slice(5, 7)) - 1;
    return {
      ym,
      label: `${MONTH_LABELS[monthIdx]}/${ym.slice(2, 4)}`,
      incomeCents,
      expenseCents,
      netCents,
      txCount: monthTxs.length,
      topExpenses: [...expenseTxs].sort((a, b) => b.amountCents - a.amountCents).slice(0, 3),
      isCurrent: ym === currentYearMonth,
    };
  });

  const maxVal = Math.max(100000, ...series.flatMap((s) => [s.incomeCents, s.expenseCents]));

  const incomePoints = series.map((item, idx) => ({
    x: 53 + idx * 94,
    y: 170 - Math.max(2, Math.round((item.incomeCents / maxVal) * 140)),
    item,
  }));

  const expensePoints = series.map((item, idx) => ({
    x: 53 + idx * 94,
    y: 170 - Math.max(2, Math.round((item.expenseCents / maxVal) * 140)),
    item,
  }));

  const incomePath = buildSmoothCurvePath(incomePoints);
  const expensePath = buildSmoothCurvePath(expensePoints);
  const incomeArea = `${incomePath} L ${incomePoints[incomePoints.length - 1].x} 170 L ${incomePoints[0].x} 170 Z`;
  const expenseArea = `${expensePath} L ${expensePoints[expensePoints.length - 1].x} 170 L ${expensePoints[0].x} 170 Z`;

  const selectedItem = series.find((s) => s.ym === activeYm) ?? null;

  function selectMonth(ym: string, toggle = false) {
    setActiveYm((prev) => {
      if (toggle && prev === ym) {
        setExpanded(false);
        return null;
      }
      return ym;
    });
  }

  return (
    <div className="chart-shell">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button
            type="button"
            className={`chip-toggle ${mode === 'bars' ? 'active' : ''}`}
            onClick={() => setMode('bars')}
          >
            <BarChart3 size={14} />
            Barras
          </button>
          <button
            type="button"
            className={`chip-toggle ${mode === 'curves' ? 'active' : ''}`}
            onClick={() => setMode('curves')}
          >
            <TrendingUp size={14} />
            Curvas
          </button>
        </div>

        <div style={{ display: 'flex', gap: 14, fontSize: 12, fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-emerald)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent-emerald)' }} />
            Entradas
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-terracotta)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent-terracotta)' }} />
            Saídas
          </span>
        </div>
      </div>

      {/* Balão informativo expansível (hover ou toque) */}
      {selectedItem ? (
        <div className="chart-tooltip-balloon" role="status" aria-live="polite">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="chart-tooltip-content">
              <strong>{selectedItem.label}</strong>
              <span className="mono text-emerald">+{formatCentsBRL(selectedItem.incomeCents)}</span>
              <span className="mono text-terracotta">-{formatCentsBRL(selectedItem.expenseCents)}</span>
              <span
                className={`tag ${selectedItem.netCents >= 0 ? 'tag-emerald' : 'tag-terracotta'} mono`}
              >
                Saldo: {formatCentsBRL(selectedItem.netCents, { showSign: true })}
              </span>
              <button
                type="button"
                className="balloon-inline-expand"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <>
                    Ocultar <ChevronUp size={13} />
                  </>
                ) : (
                  <>
                    Detalhes ({selectedItem.txCount}) <ChevronDown size={13} />
                  </>
                )}
              </button>
            </div>

            {expanded && (
              <div className="chart-tooltip-expanded">
                {selectedItem.topExpenses.length === 0 ? (
                  <span>Nenhuma saída lançada neste mês.</span>
                ) : (
                  selectedItem.topExpenses.map((tx) => (
                    <div key={tx.id} className="chart-tooltip-expanded-row">
                      <span>{tx.description}</span>
                      <span className="mono text-terracotta">-{formatCentsBRL(tx.amountCents)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="info-balloon-close"
            aria-label="Fechar balão do gráfico"
            onClick={() => {
              setActiveYm(null);
              setExpanded(false);
            }}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <p className="chart-hint">Passe o mouse ou toque em um mês para abrir e expandir o balão de detalhes.</p>
      )}

      <svg
        key={`${mode}-${currentYearMonth}`}
        viewBox="0 0 600 210"
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Gráfico comparativo de entradas e saídas dos últimos 6 meses"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = 170 - ratio * 145;
          return (
            <line
              key={ratio}
              x1={10}
              x2={590}
              y1={y}
              y2={y}
              stroke="var(--border-hairline)"
              strokeDasharray={ratio === 0 ? undefined : '3 4'}
            />
          );
        })}

        {mode === 'bars' ? (
          series.map((item, idx) => {
            const groupX = 28 + idx * 94;
            const incH = Math.max(2, Math.round((item.incomeCents / maxVal) * 140));
            const expH = Math.max(2, Math.round((item.expenseCents / maxVal) * 140));
            const isSelected = activeYm === item.ym;
            return (
              <g
                key={item.ym}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => selectMonth(item.ym, false)}
                onClick={() => selectMonth(item.ym, true)}
              >
                {(item.isCurrent || isSelected) && (
                  <rect
                    x={groupX - 8}
                    y={16}
                    width={68}
                    height={162}
                    rx={8}
                    fill={isSelected ? 'var(--accent-navy-soft)' : 'var(--bg-subtle)'}
                  />
                )}
                <rect
                  className="chart-bar-anim"
                  style={{ animationDelay: `${idx * 85}ms` }}
                  x={groupX}
                  y={170 - incH}
                  width={22}
                  height={incH}
                  rx={4}
                  fill="var(--accent-emerald)"
                />
                <rect
                  className="chart-bar-anim"
                  style={{ animationDelay: `${idx * 85 + 65}ms` }}
                  x={groupX + 28}
                  y={170 - expH}
                  width={22}
                  height={expH}
                  rx={4}
                  fill="var(--accent-terracotta)"
                />
                <text
                  x={groupX + 25}
                  y={196}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight={item.isCurrent || isSelected ? '700' : '500'}
                  fill={isSelected ? 'var(--accent-navy)' : item.isCurrent ? 'var(--ink-primary)' : 'var(--ink-muted)'}
                >
                  {item.label}
                </text>
              </g>
            );
          })
        ) : (
          <g className="anim-fade-in">
            {series.map((item, idx) => {
              const isSelected = activeYm === item.ym;
              return item.isCurrent || isSelected ? (
                <rect
                  key={item.ym}
                  x={20 + idx * 94}
                  y={16}
                  width={66}
                  height={162}
                  rx={8}
                  fill={isSelected ? 'var(--accent-navy-soft)' : 'var(--bg-subtle)'}
                />
              ) : null;
            })}
            <path d={incomeArea} className="chart-area-fade" fill="var(--accent-emerald-soft)" />
            <path d={expenseArea} className="chart-area-fade" fill="var(--accent-terracotta-soft)" />
            <path
              d={incomePath}
              className="chart-curve-draw"
              pathLength={100}
              fill="none"
              stroke="var(--accent-emerald)"
              strokeWidth="2.75"
              strokeLinecap="round"
            />
            <path
              d={expensePath}
              className="chart-curve-draw"
              pathLength={100}
              fill="none"
              stroke="var(--accent-terracotta)"
              strokeWidth="2.75"
              strokeLinecap="round"
            />
            {incomePoints.map((pt, i) => (
              <circle
                key={`inc-${pt.item.ym}`}
                className="chart-dot-pop"
                style={{ animationDelay: `${300 + i * 95}ms`, cursor: 'pointer' }}
                cx={pt.x}
                cy={pt.y}
                r={activeYm === pt.item.ym || pt.item.isCurrent ? 5.5 : 4}
                fill="var(--bg-surface)"
                stroke="var(--accent-emerald)"
                strokeWidth="2.5"
              />
            ))}
            {expensePoints.map((pt, i) => (
              <circle
                key={`exp-${pt.item.ym}`}
                className="chart-dot-pop"
                style={{ animationDelay: `${360 + i * 95}ms`, cursor: 'pointer' }}
                cx={pt.x}
                cy={pt.y}
                r={activeYm === pt.item.ym || pt.item.isCurrent ? 5.5 : 4}
                fill="var(--bg-surface)"
                stroke="var(--accent-terracotta)"
                strokeWidth="2.5"
              />
            ))}
            {series.map((item, idx) => (
              <rect
                key={`hit-${item.ym}`}
                x={18 + idx * 94}
                y={16}
                width={70}
                height={186}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => selectMonth(item.ym, false)}
                onClick={() => selectMonth(item.ym, true)}
              />
            ))}
            {series.map((item, idx) => (
              <text
                key={`lbl-${item.ym}`}
                x={53 + idx * 94}
                y={196}
                textAnchor="middle"
                fontSize="11.5"
                fontWeight={item.isCurrent || activeYm === item.ym ? '700' : '500'}
                fill={activeYm === item.ym ? 'var(--accent-navy)' : item.isCurrent ? 'var(--ink-primary)' : 'var(--ink-muted)'}
              >
                {item.label}
              </text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
