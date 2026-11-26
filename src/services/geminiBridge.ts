import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import {
  computeAccountBalanceCents,
  computeCardUsedLimitCents,
  getTodayIsoDate,
  resolveCardStatementPeriod,
} from '../domain/ledger';
import { formatCentsBRL, parseBRLToCents, subtractCents, sumCents } from '../domain/money';
import type { FinanceState, Transaction, TransactionStatus, TransactionType } from '../domain/types';
import { loadSecureJson, removeSecureItem, saveSecureJson } from './secureStorage';

export type GeminiStorageTarget = 'local' | 'drive';

export interface GeminiIntegrationConfig {
  authorized: boolean;
  authorizedAtUtc: string | null;
  storageTarget: GeminiStorageTarget;
  fileName: string;
  lastSyncedAtUtc: string | null;
  lastSyncLocation: string;
  driveFolderName: string;
}

export const GEMINI_CONFIG_KEY = 'sf_gemini_integration_v1';
export const GEMINI_MD_FILENAME = 'superfinance-gemini.md';
export const GEMINI_APP_URL = 'https://gemini.google.com/app';

export const DEFAULT_GEMINI_CONFIG: GeminiIntegrationConfig = {
  authorized: false,
  authorizedAtUtc: null,
  storageTarget: 'local',
  fileName: GEMINI_MD_FILENAME,
  lastSyncedAtUtc: null,
  lastSyncLocation: '',
  driveFolderName: 'SuperFinance',
};

export async function loadGeminiConfig(): Promise<GeminiIntegrationConfig> {
  const saved = await loadSecureJson<GeminiIntegrationConfig>(GEMINI_CONFIG_KEY);
  return {
    ...DEFAULT_GEMINI_CONFIG,
    ...(saved ?? {}),
  };
}

export async function saveGeminiConfig(config: GeminiIntegrationConfig): Promise<void> {
  await saveSecureJson(GEMINI_CONFIG_KEY, config);
}

export async function clearGeminiConfig(): Promise<void> {
  await removeSecureItem(GEMINI_CONFIG_KEY);
}

function sanitizeCell(input: string, maxLen = 80): string {
  return input
    .replace(/ya29\.[A-Za-z0-9\-_]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/[\r\n\t|]+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Gera um arquivo .md ultra-compacto (foco em menor gasto de tokens) sem credenciais ou tokens.
 */
export function buildCompactFinanceMarkdown(state: FinanceState, currentYm: string): string {
  const accountBalances = state.accounts.map((acc) => ({
    acc,
    cents: computeAccountBalanceCents(acc, state.transactions),
  }));
  const totalAccCents = sumCents(accountBalances.map((a) => a.cents));
  const totalOpenCardsCents = sumCents(
    state.cards.map((c) => computeCardUsedLimitCents(c.id, state.transactions)),
  );
  const netWorthCents = subtractCents(totalAccCents, totalOpenCardsCents);

  const monthTxs = state.transactions.filter((tx) => tx.competenceDate.startsWith(currentYm));
  const monthIncome = sumCents(monthTxs.filter((t) => t.type === 'income').map((t) => t.amountCents));
  const monthExpense = sumCents(monthTxs.filter((t) => t.type === 'expense').map((t) => t.amountCents));

  const lines: string[] = [
    '---',
    'app: SuperFinance',
    `month: ${currentYm}`,
    `updated_utc: ${new Date().toISOString()}`,
    'format: compact-delta-v1',
    '---',
    '',
    `# SuperFinance — Snapshot Compacto (${currentYm})`,
    '',
    `- **Patrimônio Líquido:** ${formatCentsBRL(netWorthCents)}`,
    `- **Entradas (${currentYm}):** ${formatCentsBRL(monthIncome)}`,
    `- **Saídas (${currentYm}):** ${formatCentsBRL(monthExpense)}`,
    `- **Faturas em Aberto:** ${formatCentsBRL(totalOpenCardsCents)}`,
    '',
    '## Contas',
    ...accountBalances.map(
      ({ acc, cents }) => `- ${sanitizeCell(acc.name, 40)} (${acc.institution}): ${formatCentsBRL(cents)}`,
    ),
    '',
    '## Cartões',
    ...state.cards.map(
      (c) =>
        `- ${sanitizeCell(c.name, 40)} (final ${c.last4}, fecha dia ${c.closingDay}, vence dia ${c.dueDay}): usado ${formatCentsBRL(computeCardUsedLimitCents(c.id, state.transactions))} / limite ${formatCentsBRL(c.limitCents)}`,
    ),
    '',
    '## Últimos Lançamentos do Mês (Máx. 20)',
    '| Data | Tipo | Descrição | Valor | Categoria | Status |',
    '| --- | --- | --- | --- | --- | --- |',
    ...monthTxs
      .slice(0, 20)
      .map(
        (tx) =>
          `| ${tx.competenceDate} | ${tx.type} | ${sanitizeCell(tx.description, 45)} | ${formatCentsBRL(tx.amountCents)} | ${sanitizeCell(tx.category, 24)} | ${tx.status} |`,
      ),
    '',
    '## NOVOS LANCAMENTOS (DELTA)',
    '<!-- Cole ou peça ao Gemini linhas no formato: + YYYY-MM-DD | expense|income | Descrição | 85,50 | ContaOuCartao | Categoria | paid|pending -->',
    '',
  ];

  return lines.join('\n');
}

/**
 * Prompt curto (~180 tokens) para iniciar uma conversa no Gemini (conta gratuita ou paga)
 * retornando apenas linhas delta (economia máxima de tokens).
 */
export function buildLowTokenGeminiPrompt(state: FinanceState, currentYm: string): string {
  const accountNames = state.accounts.map((a) => a.name).join(', ') || 'Conta Principal';
  const cardNames = state.cards.map((c) => c.name).join(', ') || 'Nenhum';
  const today = getTodayIsoDate();

  return [
    'Atue como registrador financeiro ultra-enxuto do app SuperFinance.',
    `Hoje: ${today} | Mês ativo: ${currentYm}.`,
    `Contas: [${accountNames}]. Cartões: [${cardNames}].`,
    'Quando eu informar gastos ou receitas, responda SOMENTE com linhas no formato delta (sem explicações longas):',
    '+ YYYY-MM-DD | expense ou income | Descrição | Valor (ex: 85,50) | Conta ou Cartão | Categoria | paid ou pending',
    'Exemplo: + 2026-11-26 | expense | Supermercado | 142,90 | Nubank | Alimentação | paid',
    'Aguarde meus lançamentos.',
  ].join('\n');
}

export interface ParseGeminiResult {
  transactions: Transaction[];
  errors: string[];
}

function normalizeType(raw: string): TransactionType | null {
  const v = raw.trim().toLowerCase();
  if (v === 'expense' || v === 'despesa' || v === 'saida' || v === 'saída' || v === 'gasto') return 'expense';
  if (v === 'income' || v === 'receita' || v === 'entrada') return 'income';
  if (v === 'transfer' || v === 'transferencia' || v === 'transferência') return 'transfer';
  return null;
}

function normalizeStatus(raw: string | undefined, isCard: boolean): TransactionStatus {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'pending' || v === 'pendente' || v === 'aberto' || v === 'aberta') return 'pending';
  if (v === 'paid' || v === 'pago' || v === 'paga' || v === 'quitado') return 'paid';
  return isCard ? 'pending' : 'paid';
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converte linhas delta geradas pelo Gemini (ou coladas do .md) em lançamentos exatos em centavos.
 */
export function parseGeminiDeltaCommands(rawText: string, state: FinanceState): ParseGeminiResult {
  const transactions: Transaction[] = [];
  const errors: string[] = [];

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('+') || l.startsWith('- +'));

  if (lines.length === 0) {
    return {
      transactions: [],
      errors: [
        'Nenhuma linha no formato delta encontrada. Use linhas iniciadas com "+" (ex.: + 2026-11-26 | expense | Mercado | 85,50 | Itaú | Alimentação | paid).',
      ],
    };
  }

  const nowUtc = new Date().toISOString();

  lines.forEach((line, idx) => {
    const cleaned = line.replace(/^-\s*/, '').replace(/^\+\s*/, '').trim();
    const parts = cleaned.split('|').map((p) => p.trim());
    if (parts.length < 4) {
      errors.push(`Linha ${idx + 1}: formato incompleto ("${line.slice(0, 60)}").`);
      return;
    }

    const [rawDate, rawType, rawDesc, rawAmount, rawSource = '', rawCategory = 'Outros', rawStatus] = parts;
    const competenceDate = ISO_DATE_RE.test(rawDate) ? rawDate : getTodayIsoDate();
    const type = normalizeType(rawType);
    if (!type) {
      errors.push(`Linha ${idx + 1}: tipo inválido "${rawType}" (use expense ou income).`);
      return;
    }

    const amountCents = parseBRLToCents(rawAmount);
    if (amountCents === null || amountCents <= 0) {
      errors.push(`Linha ${idx + 1}: valor inválido "${rawAmount}".`);
      return;
    }

    const description = sanitizeCell(rawDesc, 120);
    if (!description) {
      errors.push(`Linha ${idx + 1}: descrição vazia.`);
      return;
    }

    const sourceLower = rawSource.toLowerCase();
    const matchedCard =
      sourceLower
        ? state.cards.find(
            (c) =>
              c.name.toLowerCase().includes(sourceLower) ||
              sourceLower.includes(c.name.toLowerCase()) ||
              c.issuer.toLowerCase().includes(sourceLower),
          )
        : undefined;

    const matchedAccount =
      !matchedCard && sourceLower
        ? state.accounts.find(
            (a) =>
              a.name.toLowerCase().includes(sourceLower) ||
              sourceLower.includes(a.name.toLowerCase()) ||
              a.institution.toLowerCase().includes(sourceLower),
          )
        : undefined;

    const isCardTx = Boolean(matchedCard && type === 'expense');
    const status = normalizeStatus(rawStatus, isCardTx);
    const category = sanitizeCell(rawCategory || 'Outros', 40) || 'Outros';

    const tx: Transaction = {
      id: `gem-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      description,
      category,
      amountCents,
      type,
      competenceDate,
      status,
      accountId: isCardTx ? undefined : matchedAccount?.id ?? state.accounts[0]?.id,
      creditCardId: isCardTx ? matchedCard?.id : undefined,
      statementPeriod:
        isCardTx && matchedCard ? resolveCardStatementPeriod(competenceDate, matchedCard) : undefined,
      createdAtUtc: nowUtc,
    };

    transactions.push(tx);
  });

  return { transactions, errors };
}

/**
 * Grava o arquivo .md compacto no aparelho (Android Directory.Documents/SuperFinance ou sandbox local)
 * e permite download direto na Web quando em navegador.
 */
export async function saveGeminiMarkdownToDevice(
  markdownContent: string,
  target: GeminiStorageTarget,
): Promise<{ locationLabel: string; savedNatively: boolean }> {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('sf_gemini_md_snapshot_v1', markdownContent);
    } catch {
      // Ignora quota error
    }
  }

  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: `SuperFinance/${GEMINI_MD_FILENAME}`,
        data: markdownContent,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      return {
        savedNatively: true,
        locationLabel:
          target === 'drive'
            ? `Documentos/SuperFinance/${GEMINI_MD_FILENAME} (pronto para sincronizar no Google Drive)`
            : `Documentos/SuperFinance/${GEMINI_MD_FILENAME}`,
      };
    } catch {
      // Fallback para sandbox privado Directory.Data caso o Android restrinja Documents
      await Filesystem.writeFile({
        path: GEMINI_MD_FILENAME,
        data: markdownContent,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return {
        savedNatively: true,
        locationLabel: `Sandbox Privado/${GEMINI_MD_FILENAME}`,
      };
    }
  }

  return {
    savedNatively: false,
    locationLabel:
      target === 'drive'
        ? `Snapshot pronto para Google Drive (${GEMINI_MD_FILENAME})`
        : `Arquivo local do navegador (${GEMINI_MD_FILENAME})`,
  };
}

export function downloadGeminiMarkdownFile(markdownContent: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = GEMINI_MD_FILENAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
