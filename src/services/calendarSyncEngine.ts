import { Capacitor } from '@capacitor/core';
import type { CalendarEventItem } from '../domain/types';
import {
  createCalendarAlert,
  fetchCalendarEvents,
  fetchCalendarStatus,
  type CalendarStatusResponse,
  type CreateAlertPayload,
} from './calendarApi';
import {
  buildSanitizedCalendarSyncMarkdown,
  DEFAULT_CALENDAR_CONSENT,
  DEFAULT_CALENDAR_NAME,
  enqueueOutboxItems,
  type CalendarOutboxItem,
  type CalendarSyncConsent,
} from './calendarSyncLedger';
import {
  createGoogleSecondaryEvent,
  ensureGoogleSecondaryCalendar,
  getValidDirectAccessToken,
  listGoogleSecondaryEvents,
  requestInteractiveGoogleAuthorization,
  revokeGoogleAuthorization,
  trySilentWebTokenRefresh,
} from './googleDirectCalendar';
import { loadSecureJson, saveSecureJson, writePrivateMarkdownSyncLog } from './secureStorage';

const CONSENT_KEY = 'sf_cal_consent_v1';
const OUTBOX_KEY = 'sf_cal_outbox_v1';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export interface SyncCycleResult {
  consent: CalendarSyncConsent;
  status: CalendarStatusResponse;
  events: CalendarEventItem[];
  outbox: CalendarOutboxItem[];
  markdownLog: string;
  sandboxLogPath: string;
  syncedMap: Map<string, { id: string; link?: string }>;
}

export async function loadCalendarConsent(): Promise<CalendarSyncConsent> {
  const saved = await loadSecureJson<CalendarSyncConsent>(CONSENT_KEY);
  const envClientId =
    (typeof import.meta !== 'undefined' &&
      (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CALENDAR_CLIENT_ID) ||
    '';
  return {
    ...DEFAULT_CALENDAR_CONSENT,
    ...(saved ?? {}),
    oauthClientId: saved?.oauthClientId || envClientId || '',
    dedicatedCalendarName: saved?.dedicatedCalendarName || DEFAULT_CALENDAR_NAME,
  };
}

export async function saveCalendarConsent(consent: CalendarSyncConsent): Promise<void> {
  await saveSecureJson(CONSENT_KEY, consent);
}

export async function loadCalendarOutbox(): Promise<CalendarOutboxItem[]> {
  const saved = await loadSecureJson<CalendarOutboxItem[]>(OUTBOX_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveCalendarOutbox(items: readonly CalendarOutboxItem[]): Promise<void> {
  await saveSecureJson(OUTBOX_KEY, items);
}

async function persistMarkdownLedger(params: {
  consent: CalendarSyncConsent;
  connectionMode: 'google_oauth' | 'local_bridge' | 'offline_queue';
  outbox: readonly CalendarOutboxItem[];
}): Promise<{ markdownLog: string; sandboxLogPath: string }> {
  const markdownLog = buildSanitizedCalendarSyncMarkdown({
    calendarId: params.consent.dedicatedCalendarId,
    calendarName: params.consent.dedicatedCalendarName,
    connectionMode: params.connectionMode,
    authorizedAtUtc: params.consent.authorizedAtUtc,
    lastSyncUtc: params.consent.lastBackgroundSyncUtc,
    items: params.outbox,
  });
  const writeInfo = await writePrivateMarkdownSyncLog(markdownLog);
  return { markdownLog, sandboxLogPath: writeInfo.pathLabel };
}

async function tryLocalBridgeStatus(): Promise<CalendarStatusResponse | null> {
  if (Capacitor.isNativePlatform()) return null;
  try {
    return await fetchCalendarStatus();
  } catch {
    return null;
  }
}

export async function runBackgroundCalendarSync(options?: {
  consentOverride?: CalendarSyncConsent;
  extraIncoming?: readonly {
    localId: string;
    txId?: string;
    summary: string;
    date: string;
    description: string;
    recurringFreq?: 'NONE' | 'MONTHLY' | 'WEEKLY' | 'YEARLY';
    allDay?: boolean;
    colorId?: string;
    leadDays?: number;
  }[];
}): Promise<SyncCycleResult> {
  let consent = options?.consentOverride ?? (await loadCalendarConsent());
  let outbox = await loadCalendarOutbox();

  if (options?.extraIncoming && options.extraIncoming.length > 0) {
    outbox = enqueueOutboxItems(outbox, options.extraIncoming);
    await saveCalendarOutbox(outbox);
  }

  const syncedMap = new Map<string, { id: string; link?: string }>();
  let events: CalendarEventItem[] = [];
  let connectionMode: 'google_oauth' | 'local_bridge' | 'offline_queue' = 'offline_queue';

  const isAuthorized = consent.authorizedAutoConnect && consent.authorizedCreateSeparateCalendar;

  // 1. Se houver autorização explícita, tenta primeiro Bridge local (dev/servidor) ou Google Direct API v3 em segundo plano
  const localBridge = await tryLocalBridgeStatus();
  if (localBridge?.connected && isAuthorized) {
    connectionMode = 'local_bridge';
    const nextOutbox: CalendarOutboxItem[] = [];
    for (const item of outbox) {
      if (item.status === 'synced') {
        nextOutbox.push(item);
        continue;
      }
      try {
        const resp = await createCalendarAlert({
          summary: item.summary,
          date: item.date,
          description: item.description,
          recurringFreq: item.recurringFreq,
          allDay: item.allDay,
          colorId: item.colorId,
        });
        const nowUtc = new Date().toISOString();
        if (item.txId && resp.event?.id) {
          syncedMap.set(item.txId, { id: resp.event.id, link: resp.event.htmlLink });
        }
        nextOutbox.push({
          ...item,
          status: 'synced',
          syncedAtUtc: nowUtc,
          remoteEventId: resp.event?.id,
          remoteEventLink: resp.event?.htmlLink,
          lastError: undefined,
        });
      } catch (err) {
        nextOutbox.push({
          ...item,
          status: 'error',
          lastError: err instanceof Error ? err.message : 'Falha temporária ao sincronizar',
        });
      }
    }
    outbox = nextOutbox;
    await saveCalendarOutbox(outbox);

    try {
      const evResp = await fetchCalendarEvents();
      events = evResp.events;
    } catch {
      events = [];
    }

    consent = {
      ...consent,
      dedicatedCalendarId: localBridge.calendarId,
      dedicatedCalendarName: localBridge.calendarName || consent.dedicatedCalendarName,
      lastBackgroundSyncUtc: new Date().toISOString(),
    };
    await saveCalendarConsent(consent);

    const { markdownLog, sandboxLogPath } = await persistMarkdownLedger({
      consent,
      connectionMode,
      outbox,
    });
    const pendingCount = outbox.filter((i) => i.status !== 'synced').length;
    return {
      consent,
      status: {
        ...localBridge,
        connectionMode,
        outboxPendingCount: pendingCount,
      },
      events,
      outbox,
      markdownLog,
      sandboxLogPath,
      syncedMap,
    };
  }

  // 2. Conexão direta em segundo plano via Google Calendar API v3 (Android / Web estática)
  if (isAuthorized && consent.oauthClientId.trim()) {
    let token = await getValidDirectAccessToken(consent.oauthClientId.trim());
    if (!token) {
      token = await trySilentWebTokenRefresh(consent.oauthClientId.trim());
    }

    if (token) {
      try {
        const ensured = await ensureGoogleSecondaryCalendar({
          accessToken: token,
          preferredCalendarId: consent.dedicatedCalendarId,
          calendarName: consent.dedicatedCalendarName,
          timeZone: DEFAULT_TIMEZONE,
        });
        connectionMode = 'google_oauth';
        consent = {
          ...consent,
          dedicatedCalendarId: ensured.calendarId,
          dedicatedCalendarName: ensured.calendarName,
        };

        const nextOutbox: CalendarOutboxItem[] = [];
        for (const item of outbox) {
          if (item.status === 'synced') {
            nextOutbox.push(item);
            continue;
          }
          try {
            const payload: CreateAlertPayload = {
              summary: item.summary,
              date: item.date,
              description: item.description,
              recurringFreq: item.recurringFreq,
              allDay: item.allDay,
              colorId: item.colorId,
            };
            const created = await createGoogleSecondaryEvent({
              accessToken: token,
              calendarId: ensured.calendarId,
              timeZone: DEFAULT_TIMEZONE,
              payload,
            });
            if (item.txId && created.id) {
              syncedMap.set(item.txId, { id: created.id, link: created.htmlLink });
            }
            nextOutbox.push({
              ...item,
              status: 'synced',
              syncedAtUtc: new Date().toISOString(),
              remoteEventId: created.id,
              remoteEventLink: created.htmlLink,
              lastError: undefined,
            });
          } catch (err) {
            nextOutbox.push({
              ...item,
              status: 'error',
              lastError: err instanceof Error ? err.message : 'Erro ao enviar evento em segundo plano.',
            });
          }
        }
        outbox = nextOutbox;
        await saveCalendarOutbox(outbox);

        events = await listGoogleSecondaryEvents({
          accessToken: token,
          calendarId: ensured.calendarId,
        });

        consent = {
          ...consent,
          lastBackgroundSyncUtc: new Date().toISOString(),
        };
        await saveCalendarConsent(consent);

        const { markdownLog, sandboxLogPath } = await persistMarkdownLedger({
          consent,
          connectionMode,
          outbox,
        });
        const pendingCount = outbox.filter((i) => i.status !== 'synced').length;

        return {
          consent,
          status: {
            connected: true,
            calendarId: ensured.calendarId,
            calendarName: ensured.calendarName,
            timeZone: DEFAULT_TIMEZONE,
            isolatedFromPersonal: true,
            connectionMode,
            outboxPendingCount: pendingCount,
          },
          events,
          outbox,
          markdownLog,
          sandboxLogPath,
          syncedMap,
        };
      } catch {
        // Falha de rede/token expirado: mantém itens seguros na fila local para próximo ciclo em fundo
      }
    }
  }

  // 3. Fallback offline / aguardando autorização ou rede (fila local segura + log .md sanitizado)
  const { markdownLog, sandboxLogPath } = await persistMarkdownLedger({
    consent,
    connectionMode: localBridge?.connected && !isAuthorized ? 'offline_queue' : connectionMode,
    outbox,
  });
  const pendingCount = outbox.filter((i) => i.status !== 'synced').length;

  return {
    consent,
    status: {
      connected: false,
      calendarId: consent.dedicatedCalendarId,
      calendarName: consent.dedicatedCalendarName,
      timeZone: DEFAULT_TIMEZONE,
      isolatedFromPersonal: true,
      connectionMode: 'offline_queue',
      outboxPendingCount: pendingCount,
      message: !isAuthorized
        ? 'Aguardando sua autorização para conectar em segundo plano e criar o calendário financeiro separado.'
        : localBridge?.connected
          ? 'Autorize abaixo para iniciar a sincronização automática no calendário isolado.'
          : 'Fila segura ativa — os alertas serão sincronizados automaticamente em segundo plano assim que autenticado e online.',
    },
    events: [],
    outbox,
    markdownLog,
    sandboxLogPath,
    syncedMap,
  };
}

export async function authorizeAndConnectSeparateCalendar(params: {
  oauthClientId: string;
  calendarName: string;
}): Promise<SyncCycleResult> {
  const nowUtc = new Date().toISOString();
  const baseConsent: CalendarSyncConsent = {
    ...(await loadCalendarConsent()),
    authorizedAutoConnect: true,
    authorizedCreateSeparateCalendar: true,
    authorizedAtUtc: nowUtc,
    oauthClientId: params.oauthClientId.trim(),
    dedicatedCalendarName: params.calendarName.trim() || DEFAULT_CALENDAR_NAME,
  };
  await saveCalendarConsent(baseConsent);

  // Se houver bridge local ativa (dev desktop), sincroniza imediatamente sem exigir OAuth Client ID extra
  const localBridge = await tryLocalBridgeStatus();
  if (localBridge?.connected) {
    return runBackgroundCalendarSync({ consentOverride: baseConsent });
  }

  // Caso mobile Android ou Web estática, solicita autorização OAuth 2.0 com escopo mínimo calendar.app.created
  const accessToken = await requestInteractiveGoogleAuthorization(baseConsent.oauthClientId);
  const ensured = await ensureGoogleSecondaryCalendar({
    accessToken,
    preferredCalendarId: baseConsent.dedicatedCalendarId,
    calendarName: baseConsent.dedicatedCalendarName,
    timeZone: DEFAULT_TIMEZONE,
  });

  const updatedConsent: CalendarSyncConsent = {
    ...baseConsent,
    dedicatedCalendarId: ensured.calendarId,
    dedicatedCalendarName: ensured.calendarName,
  };
  await saveCalendarConsent(updatedConsent);

  return runBackgroundCalendarSync({ consentOverride: updatedConsent });
}

export async function revokeAndDisconnectCalendar(): Promise<SyncCycleResult> {
  await revokeGoogleAuthorization();
  const current = await loadCalendarConsent();
  const resetConsent: CalendarSyncConsent = {
    ...DEFAULT_CALENDAR_CONSENT,
    oauthClientId: current.oauthClientId,
  };
  await saveCalendarConsent(resetConsent);
  return runBackgroundCalendarSync({ consentOverride: resetConsent });
}
