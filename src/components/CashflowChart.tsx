import { useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { shiftYearMonth } from '../domain/ledger';
import { formatCentsBRL, sumCents } from '../domain/money';
import type { Transaction } from '../domain/types';

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
  const [mode, setMode] = useState<ChartMode>('bars');
  const months = [-4, -3, -2, -1, 0, 1].map((delta) => shiftYearMonth(currentYearMonth, delta));

  const series = months.map((ym) => {
    const monthTxs = transactions.filter((tx) => tx.competenceDate.startsWith(ym) && tx.type !== 'transfer');
    const incomeCents = sumCents(monthTxs.filter((tx) => tx.type === 'income').map((tx) => tx.amountCents));
    const expenseCents = sumCents(monthTxs.filter((tx) => tx.type === 'expense').map((tx) => tx.amountCents));
    const monthIdx = Number(ym.slice(5, 7)) - 1;
    return {
      ym,
      label: `${MONTH_LABELS[monthIdx]}/${ym.slice(2, 4)}`,
      incomeCents,
      expenseCents,
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

  return (
    <div>
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

      <svg
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
              stroke="rgba(20, 22, 25, 0.08)"
              strokeDasharray={ratio === 0 ? undefined : '3 4'}
            />
          );
        })}

        {mode === 'bars' ? (
          series.map((item, idx) => {
            const groupX = 28 + idx * 94;
            const incH = Math.max(2, Math.round((item.incomeCents / maxVal) * 140));
            const expH = Math.max(2, Math.round((item.expenseCents / maxVal) * 140));
            return (
              <g key={item.ym}>
                {item.isCurrent && (
                  <rect
                    x={groupX - 8}
                    y={16}
                    width={68}
                    height={162}
                    rx={8}
                    fill="rgba(20, 22, 25, 0.035)"
                  />
                )}
                <rect
                  className="chart-bar-anim"
                  x={groupX}
                  y={170 - incH}
                  width={22}
                  height={incH}
                  rx={4}
                  fill="#0F6E56"
                >
                  <title>{`${item.label} — Entradas: ${formatCentsBRL(item.incomeCents)}`}</title>
                </rect>
                <rect
                  className="chart-bar-anim"
                  x={groupX + 28}
                  y={170 - expH}
                  width={22}
                  height={expH}
                  rx={4}
                  fill="#C84B31"
                >
                  <title>{`${item.label} — Saídas: ${formatCentsBRL(item.expenseCents)}`}</title>
                </rect>
                <text
                  x={groupX + 25}
                  y={196}
                  textAnchor="middle"
                  fontSize="11.5"
                  fontWeight={item.isCurrent ? '700' : '500'}
                  fill={item.isCurrent ? '#141619' : '#7B8390'}
                >
                  {item.label}
                </text>
              </g>
            );
          })
        ) : (
          <g className="anim-fade-in">
            {series.map((item, idx) =>
              item.isCurrent ? (
                <rect
                  key={item.ym}
                  x={20 + idx * 94}
                  y={16}
                  width={66}
                  height={162}
                  rx={8}
                  fill="rgba(20, 22, 25, 0.035)"
                />
              ) : null,
            )}
            <path d={incomeArea} className="chart-area-fade" fill="rgba(15, 110, 86, 0.1)" />
            <path d={expenseArea} className="chart-area-fade" fill="rgba(200, 75, 49, 0.09)" />
            <path
              d={incomePath}
              className="chart-curve-draw"
              pathLength={100}
              fill="none"
              stroke="#0F6E56"
              strokeWidth="2.75"
              strokeLinecap="round"
            />
            <path
              d={expensePath}
              className="chart-curve-draw"
              pathLength={100}
              fill="none"
              stroke="#C84B31"
              strokeWidth="2.75"
              strokeLinecap="round"
            />
            {incomePoints.map((pt, i) => (
              <circle
                key={`inc-${pt.item.ym}`}
                className="chart-dot-pop"
                style={{ animationDelay: `${180 + i * 45}ms` }}
                cx={pt.x}
                cy={pt.y}
                r={pt.item.isCurrent ? 5 : 3.8}
                fill="#FFFFFF"
                stroke="#0F6E56"
                strokeWidth="2.5"
              >
                <title>{`${pt.item.label} — Entradas: ${formatCentsBRL(pt.item.incomeCents)}`}</title>
              </circle>
            ))}
            {expensePoints.map((pt, i) => (
              <circle
                key={`exp-${pt.item.ym}`}
                className="chart-dot-pop"
                style={{ animationDelay: `${220 + i * 45}ms` }}
                cx={pt.x}
                cy={pt.y}
                r={pt.item.isCurrent ? 5 : 3.8}
                fill="#FFFFFF"
                stroke="#C84B31"
                strokeWidth="2.5"
              >
                <title>{`${pt.item.label} — Saídas: ${formatCentsBRL(pt.item.expenseCents)}`}</title>
              </circle>
            ))}
            {series.map((item, idx) => (
              <text
                key={`lbl-${item.ym}`}
                x={53 + idx * 94}
                y={196}
                textAnchor="middle"
                fontSize="11.5"
                fontWeight={item.isCurrent ? '700' : '500'}
                fill={item.isCurrent ? '#141619' : '#7B8390'}
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
