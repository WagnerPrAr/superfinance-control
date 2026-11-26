export interface CalendarOutboxItem {
  localId: string;
  txId?: string;
  summary: string;
  date: string; // YYYY-MM-DD
  description: string;
  recurringFreq?: 'NONE' | 'MONTHLY' | 'WEEKLY' | 'YEARLY';
  allDay?: boolean;
  colorId?: string;
  leadDays?: number;
  status: 'pending' | 'synced' | 'error';
  createdAtUtc: string;
  syncedAtUtc?: string;
  remoteEventId?: string;
  remoteEventLink?: string;
  lastError?: string;
}

export interface CalendarSyncConsent {
  authorizedAutoConnect: boolean;
  authorizedCreateSeparateCalendar: boolean;
  authorizedAtUtc: string | null;
  oauthClientId: string;
  dedicatedCalendarId: string | null;
  dedicatedCalendarName: string;
  lastBackgroundSyncUtc: string | null;
}

export const DEFAULT_CALENDAR_NAME = 'SuperFinance — Alertas Financeiros';

export const DEFAULT_CALENDAR_CONSENT: CalendarSyncConsent = {
  authorizedAutoConnect: false,
  authorizedCreateSeparateCalendar: false,
  authorizedAtUtc: null,
  oauthClientId: '',
  dedicatedCalendarId: null,
  dedicatedCalendarName: DEFAULT_CALENDAR_NAME,
  lastBackgroundSyncUtc: null,
};

function sanitizeMarkdownCell(raw: string, maxLen = 120): string {
  // Remove segredos acidentais e caracteres que quebram tabelas Markdown
  const redacted = raw
    .replace(/ya29\.[A-Za-z0-9\-_]+/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(access_token|refresh_token|client_secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  return redacted.replace(/[\r\n\t|]+/g, ' ').trim().slice(0, maxLen);
}

export function enqueueOutboxItems(
  existing: readonly CalendarOutboxItem[],
  incoming: readonly {
    localId: string;
    txId?: string;
    summary: string;
    date: string;
    description: string;
    recurringFreq?: 'NONE' | 'MONTHLY' | 'WEEKLY' | 'YEARLY';
    allDay?: boolean;
    colorId?: string;
    leadDays?: number;
  }[],
  nowIsoUtc = new Date().toISOString(),
): CalendarOutboxItem[] {
  const next = [...existing];
  const dedupeKey = (item: { txId?: string; summary: string; date: string }) =>
    item.txId ? `tx:${item.txId}:${item.date}` : `sum:${item.summary.toLowerCase()}:${item.date}`;

  const seenKeys = new Set(next.map(dedupeKey));
  for (const item of incoming) {
    const key = dedupeKey(item);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    next.unshift({
      ...item,
      status: 'pending',
      createdAtUtc: nowIsoUtc,
    });
  }
  return next.slice(0, 120);
}

export function buildSanitizedCalendarSyncMarkdown(params: {
  calendarId: string | null;
  calendarName: string;
  connectionMode: 'google_oauth' | 'local_bridge' | 'offline_queue';
  authorizedAtUtc: string | null;
  lastSyncUtc: string | null;
  items: readonly CalendarOutboxItem[];
}): string {
  const pendingCount = params.items.filter((i) => i.status === 'pending' || i.status === 'error').length;
  const syncedCount = params.items.filter((i) => i.status === 'synced').length;

  const lines: string[] = [
    '# SuperFinance — Registro Seguro de Sincronização com Google Calendar',
    '',
    '> **Política de Segurança:** Este arquivo Markdown armazena exclusivamente o estado da fila de lembretes financeiros.',
    '> Nenhum token OAuth, chave criptográfica, senha ou dado bancário é gravado aqui.',
    '',
    `- **Calendário Isolado:** ${sanitizeMarkdownCell(params.calendarName || DEFAULT_CALENDAR_NAME, 100)}`,
    `- **ID do Calendário:** \`${params.calendarId ? sanitizeMarkdownCell(params.calendarId, 120) : 'aguardando-criacao'}\``,
    `- **Modo de Conexão:** \`${params.connectionMode}\``,
    `- **Autorização do Usuário:** ${params.authorizedAtUtc ?? 'Não autorizada'}`,
    `- **Última Sincronização em Fundo:** ${params.lastSyncUtc ?? 'Pendente'}`,
    `- **Resumo da Fila:** ${pendingCount} pendente(s) • ${syncedCount} sincronizado(s)`,
    '',
    '## Fila e Histórico de Alertas',
    '',
    '| Status | Data do Alerta | Antecedência | Descrição do Alerta | Atualizado (UTC) |',
    '| --- | --- | --- | --- | --- |',
  ];

  if (params.items.length === 0) {
    lines.push('| _vazio_ | — | — | Nenhum alerta na fila local. | — |');
  } else {
    for (const item of params.items.slice(0, 60)) {
      const statusBadge =
        item.status === 'synced' ? 'SINCRONIZADO' : item.status === 'error' ? 'REAGENDADO' : 'PENDENTE';
      const leadLabel =
        typeof item.leadDays === 'number'
          ? item.leadDays === 0
            ? 'No dia'
            : `${item.leadDays}d antes`
          : '—';
      const updated = item.syncedAtUtc ?? item.createdAtUtc;
      lines.push(
        `| ${statusBadge} | ${sanitizeMarkdownCell(item.date, 16)} | ${leadLabel} | ${sanitizeMarkdownCell(item.summary, 90)} | ${sanitizeMarkdownCell(updated, 32)} |`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
