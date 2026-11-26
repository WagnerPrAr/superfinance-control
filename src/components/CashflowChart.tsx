import { shiftYearMonth } from '../domain/ledger';
import { formatCentsBRL, sumCents } from '../domain/money';
import type { Transaction } from '../domain/types';

interface CashflowChartProps {
  transactions: readonly Transaction[];
  currentYearMonth: string;
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function CashflowChart({ transactions, currentYearMonth }: CashflowChartProps) {
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-emerald)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent-emerald)' }} />
          Entradas
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-terracotta)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent-terracotta)' }} />
          Saídas
        </span>
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

        {series.map((item, idx) => {
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
        })}
      </svg>
    </div>
  );
}
