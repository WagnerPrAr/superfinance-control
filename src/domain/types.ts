export type AccountType = 'checking' | 'savings' | 'cash' | 'investment';

export type TransactionType = 'income' | 'expense' | 'transfer';

export type TransactionStatus = 'paid' | 'pending';

export type RecurrenceFrequency = 'monthly' | 'weekly' | 'yearly';

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  /** Saldo inicial em centavos inteiros (zero float) */
  initialBalanceCents: number;
  accentColor: string;
}

export interface CreditCard {
  id: string;
  name: string;
  issuer: string;
  last4: string;
  /** Limite total em centavos inteiros */
  limitCents: number;
  /** Dia de fechamento da fatura (1..28) */
  closingDay: number;
  /** Dia de vencimento da fatura (1..31) */
  dueDay: number;
  /** Conta padrão para pagamento da fatura */
  defaultAccountId: string;
  accentColor: string;
}

export interface Transaction {
  id: string;
  description: string;
  category: string;
  /** Valor positivo em centavos inteiros (zero float) */
  amountCents: number;
  type: TransactionType;
  /** Data de competência / vencimento no formato ISO YYYY-MM-DD (sem fuso/horário) */
  competenceDate: string;
  status: TransactionStatus;
  /** Conta de origem/destino (para transações em conta ou transferências) */
  accountId?: string;
  /** Conta destino quando type === 'transfer' */
  toAccountId?: string;
  /** Cartão de crédito quando compra feita no crédito */
  creditCardId?: string;
  /** Período explícito da fatura (YYYY-MM) para compras no cartão */
  statementPeriod?: string;
  /** Metadados de parcelamento */
  installmentIndex?: number;
  installmentTotal?: number;
  installmentGroupId?: string;
  /** Chave única determinística para recorrências: `${recurrenceRuleId}::${billingPeriod}` */
  idempotencyKey?: string;
  recurrenceRuleId?: string;
  important?: boolean;
  /** ID do evento criado no Google Calendar, se sincronizado */
  calendarEventId?: string;
  calendarEventLink?: string;
  createdAtUtc: string;
}

export interface RecurrenceRule {
  id: string;
  title: string;
  category: string;
  /** Valor em centavos inteiros */
  amountCents: number;
  type: 'income' | 'expense';
  frequency: RecurrenceFrequency;
  interval: number;
  /** Dia do mês desejado (1..31); ajustado para último dia válido em meses curtos/bissextos */
  dayOfMonth: number;
  startDate: string;
  endDate?: string;
  accountId?: string;
  creditCardId?: string;
  important: boolean;
  autoCalendarAlert: boolean;
  active: boolean;
}

export interface CalendarEventItem {
  id: string;
  summary: string;
  description?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

export interface FinanceState {
  accounts: Account[];
  cards: CreditCard[];
  transactions: Transaction[];
  recurrences: RecurrenceRule[];
}
