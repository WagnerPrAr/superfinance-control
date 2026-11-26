import { buildIcsContent } from '../domain/ledger';
import type { CalendarEventItem } from '../domain/types';

export interface CalendarStatusResponse {
  connected: boolean;
  calendarId: string | null;
  calendarName: string;
  timeZone: string;
  isolatedFromPersonal?: boolean;
  message?: string;
}

export interface CreateAlertPayload {
  summary: string;
  date: string; // YYYY-MM-DD
  description?: string;
  recurringFreq?: 'NONE' | 'MONTHLY' | 'WEEKLY' | 'YEARLY';
  allDay?: boolean;
  colorId?: string;
}

export interface CreateAlertResponse {
  created: boolean;
  calendarId: string;
  calendarName: string;
  event: {
    id?: string;
    htmlLink?: string;
    summary?: string;
  };
}

export async function fetchCalendarStatus(): Promise<CalendarStatusResponse> {
  const res = await fetch('/api/calendar/status');
  if (!res.ok) {
    throw new Error('Bridge local do Google Calendar indisponível.');
  }
  return (await res.json()) as CalendarStatusResponse;
}

export async function fetchCalendarEvents(): Promise<{
  calendarId: string;
  calendarName: string;
  events: CalendarEventItem[];
}> {
  const res = await fetch('/api/calendar/events');
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Erro ao buscar eventos do Google Calendar.');
  }
  return (await res.json()) as {
    calendarId: string;
    calendarName: string;
    events: CalendarEventItem[];
  };
}

export async function createCalendarAlert(payload: CreateAlertPayload): Promise<CreateAlertResponse> {
  const res = await fetch('/api/calendar/alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as CreateAlertResponse & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Falha ao criar alerta no Google Calendar.');
  }
  return data;
}

export function buildGoogleCalendarWebUrl(params: {
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD
}): string {
  const start = params.date.replace(/-/g, '');
  const [y, m, d] = params.date.split('-').map(Number);
  const nextDt = new Date(Date.UTC(y, m - 1, d + 1));
  const end = `${nextDt.getUTCFullYear()}${String(nextDt.getUTCMonth() + 1).padStart(2, '0')}${String(nextDt.getUTCDate()).padStart(2, '0')}`;
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.summary);
  url.searchParams.set('dates', `${start}/${end}`);
  url.searchParams.set('details', params.description);
  return url.toString();
}

export function downloadIcsFallback(params: {
  uid: string;
  summary: string;
  description: string;
  date: string;
}): void {
  const content = buildIcsContent(params);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alerta-superfinance-${params.date}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
