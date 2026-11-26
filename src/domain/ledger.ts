import { addCents, splitInstallmentsCents, subtractCents, sumCents } from './money';
import type { Account, CreditCard, RecurrenceRule, Transaction } from './types';

/**
 * Utilitários de datas civis ISO (YYYY-MM-DD) sem horário/fuso,
 * tratando anos bissextos e meses de 28/29/30/31 dias.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month1Based: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month1Based - 1] ?? 30;
}

export function formatIsoDate(year: number, month1Based: number, day: number): string {
  const clampedDay = Math.max(1, Math.min(day, daysInMonth(year, month1Based)));
  return `${String(year).padStart(4, '0')}-${String(month1Based).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function formatYearMonth(year: number, month1Based: number): string {
  return `${String(year).padStart(4, '0')}-${String(month1Based).padStart(2, '0')}`;
}

export function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

export function shiftYearMonth(ym: string, deltaMonths: number): string {
  const { year, month } = parseYearMonth(ym);
  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = ((totalMonths % 12) + 12) % 12 + 1;
  return formatYearMonth(nextYear, nextMonth);
}

export function getTodayIsoDate(): string {
  const now = new Date();
  return formatIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function getCurrentYearMonth(): string {
  const now = new Date();
  return formatYearMonth(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Determina o período da fatura (YYYY-MM) de uma compra no cartão de crédito,
 * separando claramente `closingDay` (fechamento) de `dueDay` (vencimento).
 *
 * Regra:
 * - Se o dia da compra for MENOR que `closingDay`, entra na fatura cujo vencimento
 *   ocorre no mês de referência (ou mês seguinte caso `dueDay < closingDay`).
 * - Se o dia da compra for MAIOR OU IGUAL a `closingDay`, entra na fatura seguinte.
 */
export function resolveCardStatementPeriod(purchaseIsoDate: string, card: Pick<CreditCard, 'closingDay' | 'dueDay'>): string {
  const [year, month, day] = purchaseIsoDate.split('-').map(Number);
  const baseYm = formatYearMonth(year, month);
  const afterClosing = day >= card.closingDay ? 1 : 0;
  const dueInNextMonth = card.dueDay < card.closingDay ? 1 : 0;
  return shiftYearMonth(baseYm, afterClosing + dueInNextMonth);
}

/**
 * Retorna a data exata de vencimento (YYYY-MM-DD) de uma fatura `statementPeriod` (YYYY-MM).
 */
export function getCardStatementDueDate(statementPeriod: string, dueDay: number): string {
  const { year, month } = parseYearMonth(statementPeriod);
  return formatIsoDate(year, month, dueDay);
}

/**
 * Cria transações parceladas explícitas no cartão de crédito, vinculando cada parcela
 * à sua fatura (`statementPeriod`) correspondente.
 */
export function createCardInstallmentTransactions(params: {
  idPrefix: string;
  description: string;
  category: string;
  totalAmountCents: number;
  installments: number;
  purchaseDate: string;
  card: CreditCard;
  important?: boolean;
}): Transaction[] {
  const slices = splitInstallmentsCents(params.totalAmountCents, params.installments);
  const firstPeriod = resolveCardStatementPeriod(params.purchaseDate, params.card);
  const nowUtc = new Date().toISOString();

  return slices.map((sliceCents, idx) => {
    const period = shiftYearMonth(firstPeriod, idx);
    const dueDate = getCardStatementDueDate(period, params.card.dueDay);
    return {
      id: `${params.idPrefix}-${idx + 1}`,
      description:
        params.installments > 1
          ? `${params.description} (${idx + 1}/${params.installments})`
          : params.description,
      category: params.category,
      amountCents: sliceCents,
      type: 'expense',
      competenceDate: dueDate,
      status: 'pending',
      creditCardId: params.card.id,
      statementPeriod: period,
      installmentIndex: idx + 1,
      installmentTotal: params.installments,
      installmentGroupId: params.idPrefix,
      important: params.important,
      createdAtUtc: nowUtc,
    };
  });
}

/**
 * Calcula o saldo atual de uma conta (em centavos inteiros),
 * considerando apenas transações liquidadas (`paid`) na conta.
 */
export function computeAccountBalanceCents(account: Account, transactions: readonly Transaction[]): number {
  let balance = account.initialBalanceCents;
  for (const tx of transactions) {
    if (tx.status !== 'paid') continue;
    if (tx.creditCardId) continue;
    if (tx.type === 'income' && tx.accountId === account.id) {
      balance = addCents(balance, tx.amountCents);
    } else if (tx.type === 'expense' && tx.accountId === account.id) {
      balance = subtractCents(balance, tx.amountCents);
    } else if (tx.type === 'transfer') {
      if (tx.accountId === account.id) {
        balance = subtractCents(balance, tx.amountCents);
      }
      if (tx.toAccountId === account.id) {
        balance = addCents(balance, tx.amountCents);
      }
    }
  }
  return balance;
}

/**
 * Calcula o total de uma fatura específica (`statementPeriod`) de um cartão.
 */
export function computeCardStatementCents(
  cardId: string,
  statementPeriod: string,
  transactions: readonly Transaction[],
): number {
  return sumCents(
    transactions
      .filter((tx) => tx.creditCardId === cardId && tx.statementPeriod === statementPeriod)
      .map((tx) => tx.amountCents),
  );
}

/**
 * Calcula o limite comprometido (todas as parcelas/faturas em aberto `pending`) de um cartão.
 */
export function computeCardUsedLimitCents(cardId: string, transactions: readonly Transaction[]): number {
  return sumCents(
    transactions
      .filter((tx) => tx.creditCardId === cardId && tx.status === 'pending')
      .map((tx) => tx.amountCents),
  );
}

/**
 * Chave de idempotência determinística para o motor de recorrências.
 */
export function buildRecurrenceIdempotencyKey(ruleId: string, billingPeriod: string): string {
  return `${ruleId}::${billingPeriod}`;
}

/**
 * Motor Idempotente de Recorrências:
 * Gera ocorrências de regras ativas para o mês alvo (`targetYearMonth`, ex.: "2026-11")
 * garantindo que reexecuções NUNCA dupliquem cobranças já existentes.
 */
export function generateRecurringTransactionsForPeriod(
  rules: readonly RecurrenceRule[],
  existingTransactions: readonly Transaction[],
  targetYearMonth: string,
  cardsById: ReadonlyMap<string, CreditCard> = new Map(),
): Transaction[] {
  const existingKeys = new Set(
    existingTransactions.map((tx) => tx.idempotencyKey).filter((k): k is string => Boolean(k)),
  );
  const { year, month } = parseYearMonth(targetYearMonth);
  const created: Transaction[] = [];
  const nowUtc = new Date().toISOString();

  for (const rule of rules) {
    if (!rule.active) continue;

    // Verifica se o mês alvo está dentro do intervalo [startDate, endDate]
    const ruleStartYm = rule.startDate.slice(0, 7);
    if (targetYearMonth < ruleStartYm) continue;
    if (rule.endDate && targetYearMonth > rule.endDate.slice(0, 7)) continue;

    if (rule.frequency === 'yearly') {
      const startMonth = Number(rule.startDate.slice(5, 7));
      const startYear = Number(rule.startDate.slice(0, 4));
      if (month !== startMonth || (year - startYear) % Math.max(1, rule.interval) !== 0) {
        continue;
      }
      const key = buildRecurrenceIdempotencyKey(rule.id, targetYearMonth);
      if (existingKeys.has(key)) continue;

      const competenceDate = formatIsoDate(year, month, rule.dayOfMonth);
      const card = rule.creditCardId ? cardsById.get(rule.creditCardId) : undefined;
      created.push({
        id: `rec-${rule.id}-${targetYearMonth}`,
        description: rule.title,
        category: rule.category,
        amountCents: rule.amountCents,
        type: rule.type,
        competenceDate,
        status: 'pending',
        accountId: rule.accountId,
        creditCardId: rule.creditCardId,
        statementPeriod: card ? resolveCardStatementPeriod(competenceDate, card) : undefined,
        idempotencyKey: key,
        recurrenceRuleId: rule.id,
        important: rule.important,
        createdAtUtc: nowUtc,
      });
      existingKeys.add(key);
      continue;
    }

    if (rule.frequency === 'monthly') {
      const { year: sy, month: sm } = parseYearMonth(ruleStartYm);
      const monthsDiff = (year - sy) * 12 + (month - sm);
      if (monthsDiff < 0 || monthsDiff % Math.max(1, rule.interval) !== 0) {
        continue;
      }
      const key = buildRecurrenceIdempotencyKey(rule.id, targetYearMonth);
      if (existingKeys.has(key)) continue;

      const competenceDate = formatIsoDate(year, month, rule.dayOfMonth);
      const card = rule.creditCardId ? cardsById.get(rule.creditCardId) : undefined;
      created.push({
        id: `rec-${rule.id}-${targetYearMonth}`,
        description: rule.title,
        category: rule.category,
        amountCents: rule.amountCents,
        type: rule.type,
        competenceDate,
        status: 'pending',
        accountId: rule.accountId,
        creditCardId: rule.creditCardId,
        statementPeriod: card ? resolveCardStatementPeriod(competenceDate, card) : undefined,
        idempotencyKey: key,
        recurrenceRuleId: rule.id,
        important: rule.important,
        createdAtUtc: nowUtc,
      });
      existingKeys.add(key);
      continue;
    }

    if (rule.frequency === 'weekly') {
      // Gera até 4/5 ocorrências semanais dentro do mês alvo
      const maxDay = daysInMonth(year, month);
      const stepDays = 7 * Math.max(1, rule.interval);
      let day = Math.min(rule.dayOfMonth, 7);
      let weekIdx = 1;
      while (day <= maxDay) {
        const competenceDate = formatIsoDate(year, month, day);
        if (competenceDate >= rule.startDate && (!rule.endDate || competenceDate <= rule.endDate)) {
          const periodKey = `${targetYearMonth}-W${weekIdx}`;
          const key = buildRecurrenceIdempotencyKey(rule.id, periodKey);
          if (!existingKeys.has(key)) {
            const card = rule.creditCardId ? cardsById.get(rule.creditCardId) : undefined;
            created.push({
              id: `rec-${rule.id}-${periodKey}`,
              description: `${rule.title} (Sem. ${weekIdx})`,
              category: rule.category,
              amountCents: rule.amountCents,
              type: rule.type,
              competenceDate,
              status: 'pending',
              accountId: rule.accountId,
              creditCardId: rule.creditCardId,
              statementPeriod: card ? resolveCardStatementPeriod(competenceDate, card) : undefined,
              idempotencyKey: key,
              recurrenceRuleId: rule.id,
              important: rule.important,
              createdAtUtc: nowUtc,
            });
            existingKeys.add(key);
          }
        }
        day += stepDays;
        weekIdx += 1;
      }
    }
  }

  return created;
}

/**
 * Gera conteúdo .ics compatível com RFC 5545 como fallback offline
 * caso o usuário queira importar um alerta manualmente em qualquer calendário.
 */
export function buildIcsContent(params: {
  uid: string;
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD
}): string {
  const dtStart = params.date.replace(/-/g, '');
  const [y, m, d] = params.date.split('-').map(Number);
  const nextDt = new Date(Date.UTC(y, m - 1, d + 1));
  const dtEnd = `${nextDt.getUTCFullYear()}${String(nextDt.getUTCMonth() + 1).padStart(2, '0')}${String(nextDt.getUTCDate()).padStart(2, '0')}`;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SuperFinance//Controle Financeiro//PT-BR',
    'BEGIN:VEVENT',
    `UID:${esc(params.uid)}@superfinance.local`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${esc(params.summary)}`,
    `DESCRIPTION:${esc(params.description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:Lembrete financeiro: ${esc(params.summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
