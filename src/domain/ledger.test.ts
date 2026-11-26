import { describe, expect, it } from 'vitest';
import {
  buildRecurrenceIdempotencyKey,
  computeAccountBalanceCents,
  computeCardStatementCents,
  computeCardUsedLimitCents,
  createCardInstallmentTransactions,
  formatIsoDate,
  generateRecurringTransactionsForPeriod,
  isLeapYear,
  resolveCardStatementPeriod,
  subtractDaysFromIsoDate,
} from './ledger';
import { formatCentsBRL, parseBRLToCents, splitInstallmentsCents, sumCents } from './money';
import type { Account, CreditCard, RecurrenceRule, Transaction } from './types';

describe('Money — Aritmética exata em centavos (Zero Float)', () => {
  it('converte entradas BRL e decimais para centavos inteiros sem imprecisão IEEE-754', () => {
    expect(parseBRLToCents('R$ 1.250,90')).toBe(125090);
    expect(parseBRLToCents('0,10') + parseBRLToCents('0,20')).toBe(30);
    expect(parseBRLToCents('19.99')).toBe(1999);
    expect(parseBRLToCents('2500')).toBe(250000);
    expect(parseBRLToCents('-42,50')).toBe(-4250);
  });

  it('formata centavos inteiros em pt-BR corretamente', () => {
    expect(formatCentsBRL(125090)).toBe('R$ 1.250,90');
    expect(formatCentsBRL(-4250)).toBe('-R$ 42,50');
    expect(formatCentsBRL(500, { showSign: true })).toBe('+R$ 5,00');
    expect(formatCentsBRL(0)).toBe('R$ 0,00');
  });

  it('divide parcelamentos alocando resto de centavos na 1ª parcela sem perder 1 centavo', () => {
    const slices = splitInstallmentsCents(10000, 3); // R$ 100,00 em 3x
    expect(slices).toEqual([3334, 3333, 3333]);
    expect(sumCents(slices)).toBe(10000);
  });
});

describe('Datas — Anos bissextos, fim de mês e antecedência de alertas', () => {
  it('trata corretamente fevereiro em ano bissexto e não bissexto', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(formatIsoDate(2024, 2, 31)).toBe('2024-02-29');
    expect(formatIsoDate(2026, 2, 31)).toBe('2026-02-28');
    expect(formatIsoDate(2026, 4, 31)).toBe('2026-04-30');
  });

  it('calcula data de alerta antecipado respeitando virada de mês, ano e bissexto', () => {
    expect(subtractDaysFromIsoDate('2026-12-01', 3)).toBe('2026-11-28');
    expect(subtractDaysFromIsoDate('2027-01-02', 3)).toBe('2026-12-30');
    expect(subtractDaysFromIsoDate('2024-03-01', 1)).toBe('2024-02-29');
    expect(subtractDaysFromIsoDate('2026-03-01', 1)).toBe('2026-02-28');
    expect(subtractDaysFromIsoDate('2026-11-30', 0)).toBe('2026-11-30');
  });
});

describe('Cartões de Crédito — Fechamento vs Vencimento e Parcelas Explícitas', () => {
  const card: CreditCard = {
    id: 'card-1',
    name: 'Ultravioleta',
    issuer: 'Nubank',
    last4: '4821',
    limitCents: 1500000,
    closingDay: 25,
    dueDay: 5,
    defaultAccountId: 'acc-1',
    accentColor: '#24567A',
  };

  it('separa compras antes e depois do fechamento corretamente (incluindo virada de ano)', () => {
    // Fechamento dia 25, vencimento dia 5 (do mês seguinte)
    expect(resolveCardStatementPeriod('2026-11-24', card)).toBe('2026-12');
    expect(resolveCardStatementPeriod('2026-11-25', card)).toBe('2027-01');
    expect(resolveCardStatementPeriod('2026-12-26', card)).toBe('2027-02');
  });

  it('aloca parcelas em faturas explícitas e calcula total da fatura e limite usado', () => {
    const txs = createCardInstallmentTransactions({
      idPrefix: 'buy-notebook',
      description: 'Notebook Trabalho',
      category: 'Tecnologia',
      totalAmountCents: 300000,
      installments: 3,
      purchaseDate: '2026-11-10',
      card,
    });

    expect(txs).toHaveLength(3);
    expect(txs.map((t) => t.statementPeriod)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(computeCardStatementCents('card-1', '2026-12', txs)).toBe(100000);
    expect(computeCardUsedLimitCents('card-1', txs)).toBe(300000);
  });
});

describe('Motor de Recorrências — Idempotência Absoluta', () => {
  const rules: RecurrenceRule[] = [
    {
      id: 'rule-aluguel',
      title: 'Aluguel Residencial',
      category: 'Moradia',
      amountCents: 245000,
      type: 'expense',
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 31,
      startDate: '2026-01-01',
      accountId: 'acc-1',
      important: true,
      autoCalendarAlert: true,
      active: true,
    },
  ];

  it('gera ocorrência com clamp de dia 31 em fevereiro e nunca duplica ao reexecutar', () => {
    const firstRun = generateRecurringTransactionsForPeriod(rules, [], '2026-02');
    expect(firstRun).toHaveLength(1);
    expect(firstRun[0].competenceDate).toBe('2026-02-28');
    expect(firstRun[0].idempotencyKey).toBe(buildRecurrenceIdempotencyKey('rule-aluguel', '2026-02'));

    const secondRun = generateRecurringTransactionsForPeriod(rules, firstRun, '2026-02');
    expect(secondRun).toHaveLength(0);
  });
});

describe('Contas — Saldo calculado exclusivamente sobre lançamentos pagos', () => {
  const checking: Account = {
    id: 'acc-1',
    name: 'Conta Corrente',
    institution: 'Itaú',
    type: 'checking',
    initialBalanceCents: 100000,
    accentColor: '#0F6E56',
  };
  const savings: Account = {
    id: 'acc-2',
    name: 'Reserva',
    institution: 'Nubank',
    type: 'savings',
    initialBalanceCents: 500000,
    accentColor: '#24567A',
  };

  it('soma receitas pagas, subtrai despesas pagas, aplica transferências e ignora pendentes', () => {
    const txs: Transaction[] = [
      {
        id: 't1',
        description: 'Salário',
        category: 'Renda',
        amountCents: 500000,
        type: 'income',
        competenceDate: '2026-11-05',
        status: 'paid',
        accountId: 'acc-1',
        createdAtUtc: '2026-11-05T12:00:00Z',
      },
      {
        id: 't2',
        description: 'Energia (pendente)',
        category: 'Contas Fixas',
        amountCents: 35000,
        type: 'expense',
        competenceDate: '2026-11-28',
        status: 'pending',
        accountId: 'acc-1',
        createdAtUtc: '2026-11-05T12:00:00Z',
      },
      {
        id: 't3',
        description: 'Aporte Reserva',
        category: 'Transferência',
        amountCents: 150000,
        type: 'transfer',
        competenceDate: '2026-11-10',
        status: 'paid',
        accountId: 'acc-1',
        toAccountId: 'acc-2',
        createdAtUtc: '2026-11-10T12:00:00Z',
      },
    ];

    expect(computeAccountBalanceCents(checking, txs)).toBe(450000);
    expect(computeAccountBalanceCents(savings, txs)).toBe(650000);
  });
});
