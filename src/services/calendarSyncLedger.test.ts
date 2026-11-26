import { describe, expect, it } from 'vitest';
import {
  buildSanitizedCalendarSyncMarkdown,
  enqueueOutboxItems,
} from './calendarSyncLedger';

describe('calendarSyncLedger', () => {
  it('enqueues alerts idempotently without duplicating txId + date', () => {
    const first = enqueueOutboxItems(
      [],
      [
        {
          localId: 'a1',
          txId: 'tx-10',
          summary: '[SuperFinance] Internet (R$ 120,00)',
          date: '2026-12-05',
          description: 'Mensalidade',
          leadDays: 2,
        },
      ],
      '2026-11-26T00:00:00Z',
    );
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe('pending');

    const second = enqueueOutboxItems(
      first,
      [
        {
          localId: 'a2',
          txId: 'tx-10',
          summary: '[SuperFinance] Internet (R$ 120,00)',
          date: '2026-12-05',
          description: 'Mensalidade',
          leadDays: 2,
        },
        {
          localId: 'a3',
          txId: 'tx-11',
          summary: '[SuperFinance] Luz (R$ 240,00)',
          date: '2026-12-10',
          description: 'Energia',
          leadDays: 1,
        },
      ],
      '2026-11-26T00:05:00Z',
    );

    expect(second).toHaveLength(2);
    expect(second.map((i) => i.txId)).toEqual(['tx-11', 'tx-10']);
  });

  it('redacts accidental OAuth tokens and secrets in sanitized Markdown log', () => {
    const md = buildSanitizedCalendarSyncMarkdown({
      calendarId: 'cal-finance-123',
      calendarName: 'SuperFinance — Alertas Financeiros',
      connectionMode: 'google_oauth',
      authorizedAtUtc: '2026-11-26T03:00:00Z',
      lastSyncUtc: '2026-11-26T03:01:00Z',
      items: [
        {
          localId: 'l1',
          summary: 'Fatura ya29.secret_token_value Bearer abc12345',
          date: '2026-12-01',
          description: 'refresh_token=supersecret',
          leadDays: 3,
          status: 'synced',
          createdAtUtc: '2026-11-26T03:00:00Z',
          syncedAtUtc: '2026-11-26T03:01:00Z',
        },
      ],
    });

    expect(md).not.toContain('ya29.secret_token_value');
    expect(md).not.toContain('abc12345');
    expect(md).toContain('[REDACTED_TOKEN]');
    expect(md).toContain('Bearer [REDACTED]');
    expect(md).toContain('| SINCRONIZADO | 2026-12-01 | 3d antes |');
  });
});
