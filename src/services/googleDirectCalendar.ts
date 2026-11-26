import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { CalendarEventItem } from '../domain/types';
import type { CreateAlertPayload } from './calendarApi';
import { loadSecureJson, removeSecureItem, saveSecureJson } from './secureStorage';

export const GOOGLE_CALENDAR_APP_CREATED_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const ANDROID_OAUTH_REDIRECT_URI = 'br.com.superfinance.app:/oauth2redirect';

const TOKEN_STORAGE_KEY = 'sf_gcal_encrypted_token_v1';
const PKCE_STORAGE_KEY = 'sf_gcal_pkce_state_v1';

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  clientId: string;
  scope: string;
}

interface PkceDraft {
  state: string;
  codeVerifier: string;
  clientId: string;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: {
              access_token?: string;
              expires_in?: number;
              error?: string;
              error_description?: string;
            }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | null = null;

function ensureGisScriptLoaded(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Ambiente sem DOM.'));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Identity Services.')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Sem conexão para carregar login Google OAuth.'));
    document.head.appendChild(script);
  });

  return gisScriptPromise;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function generatePkcePair(): Promise<{ verifier: string; challenge: string; state: string }> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const verifier = base64UrlEncode(randomBytes);

  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64UrlEncode(stateBytes);

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge, state };
}

function addOneDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export async function getValidDirectAccessToken(clientId: string): Promise<string | null> {
  const stored = await loadSecureJson<StoredToken>(TOKEN_STORAGE_KEY);
  if (!stored) return null;
  if (stored.clientId && clientId && stored.clientId !== clientId) return null;

  const now = Date.now();
  if (stored.accessToken && stored.expiresAtMs > now + 60_000) {
    return stored.accessToken;
  }

  // Renovação silenciosa via refresh_token (fluxo nativo Android PKCE)
  if (stored.refreshToken && clientId) {
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
      });
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (res.ok) {
        const data = (await res.json()) as { access_token?: string; expires_in?: number };
        if (data.access_token) {
          await saveSecureJson<StoredToken>(TOKEN_STORAGE_KEY, {
            ...stored,
            accessToken: data.access_token,
            expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
          });
          return data.access_token;
        }
      }
    } catch {
      // Silencioso em offline/erro de rede
    }
  }

  return null;
}

export async function trySilentWebTokenRefresh(clientId: string): Promise<string | null> {
  if (!clientId || Capacitor.isNativePlatform()) return null;
  try {
    await ensureGisScriptLoaded();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) return null;

    return await new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 5500);
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_CALENDAR_APP_CREATED_SCOPE,
        callback: (resp) => {
          window.clearTimeout(timer);
          if (resp.access_token) {
            void saveSecureJson<StoredToken>(TOKEN_STORAGE_KEY, {
              accessToken: resp.access_token,
              expiresAtMs: Date.now() + (resp.expires_in ?? 3500) * 1000,
              clientId,
              scope: GOOGLE_CALENDAR_APP_CREATED_SCOPE,
            });
            resolve(resp.access_token);
          } else {
            resolve(null);
          }
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    });
  } catch {
    return null;
  }
}

export async function requestInteractiveGoogleAuthorization(clientId: string): Promise<string> {
  const cleanClientId = clientId.trim();
  if (!cleanClientId) {
    throw new Error('Informe o Google OAuth Client ID para conectar diretamente pelo app.');
  }

  // Fluxo nativo Android via Chrome Custom Tabs + PKCE (sem client_secret no APK)
  if (Capacitor.isNativePlatform()) {
    const { verifier, challenge, state } = await generatePkcePair();
    await saveSecureJson<PkceDraft>(PKCE_STORAGE_KEY, {
      state,
      codeVerifier: verifier,
      clientId: cleanClientId,
    });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', cleanClientId);
    authUrl.searchParams.set('redirect_uri', ANDROID_OAUTH_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_CALENDAR_APP_CREATED_SCOPE);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let handle: { remove: () => Promise<void> } | null = null;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        void handle?.remove();
        reject(new Error('Tempo limite aguardando autorização no navegador Google.'));
      }, 120_000);

      void CapApp.addListener('appUrlOpen', async (event) => {
        if (!event.url.startsWith(ANDROID_OAUTH_REDIRECT_URI)) return;
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        void handle?.remove();
        try {
          await Browser.close().catch(() => {});
          const callbackUrl = new URL(event.url);
          const code = callbackUrl.searchParams.get('code');
          const returnedState = callbackUrl.searchParams.get('state');
          const error = callbackUrl.searchParams.get('error');
          if (error) {
            throw new Error(`Autorização Google cancelada ou negada (${error}).`);
          }
          const draft = await loadSecureJson<PkceDraft>(PKCE_STORAGE_KEY);
          if (!code || !draft || returnedState !== draft.state) {
            throw new Error('Validação PKCE OAuth falhou. Tente autorizar novamente.');
          }
          const tokenBody = new URLSearchParams({
            client_id: draft.clientId,
            code,
            code_verifier: draft.codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: ANDROID_OAUTH_REDIRECT_URI,
          });
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenBody.toString(),
          });
          const tokenData = (await tokenRes.json()) as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            error_description?: string;
          };
          if (!tokenRes.ok || !tokenData.access_token) {
            throw new Error(tokenData.error_description || 'Falha ao trocar código OAuth pelo token Google.');
          }
          await saveSecureJson<StoredToken>(TOKEN_STORAGE_KEY, {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAtMs: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
            clientId: draft.clientId,
            scope: GOOGLE_CALENDAR_APP_CREATED_SCOPE,
          });
          await removeSecureItem(PKCE_STORAGE_KEY);
          resolve(tokenData.access_token);
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Erro no retorno OAuth Android.'));
        }
      }).then((listener) => {
        handle = listener;
      });

      void Browser.open({ url: authUrl.toString() });
    });
  }

  // Fluxo Web via Google Identity Services
  await ensureGisScriptLoaded();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google Identity Services indisponível neste navegador.');
  }

  return await new Promise<string>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: cleanClientId,
      scope: GOOGLE_CALENDAR_APP_CREATED_SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Autorização Google não concedida.'));
          return;
        }
        void saveSecureJson<StoredToken>(TOKEN_STORAGE_KEY, {
          accessToken: resp.access_token,
          expiresAtMs: Date.now() + (resp.expires_in ?? 3500) * 1000,
          clientId: cleanClientId,
          scope: GOOGLE_CALENDAR_APP_CREATED_SCOPE,
        });
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export async function revokeGoogleAuthorization(): Promise<void> {
  const stored = await loadSecureJson<StoredToken>(TOKEN_STORAGE_KEY);
  if (stored?.accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(stored.accessToken)}`, {
        method: 'POST',
      });
    } catch {
      // Segue removendo localmente mesmo offline
    }
  }
  await removeSecureItem(TOKEN_STORAGE_KEY);
  await removeSecureItem(PKCE_STORAGE_KEY);
}

export async function ensureGoogleSecondaryCalendar(params: {
  accessToken: string;
  preferredCalendarId: string | null;
  calendarName: string;
  timeZone: string;
}): Promise<{ calendarId: string; calendarName: string; createdNow: boolean }> {
  const headers = {
    Authorization: `Bearer ${params.accessToken}`,
    'Content-Type': 'application/json',
  };

  // 1. Verifica ID salvo se ainda existir e pertencer ao usuário
  if (params.preferredCalendarId && params.preferredCalendarId !== 'primary') {
    const check = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.preferredCalendarId)}`,
      { headers },
    );
    if (check.ok) {
      const existing = (await check.json()) as { id?: string; summary?: string };
      if (existing.id) {
        return {
          calendarId: existing.id,
          calendarName: existing.summary || params.calendarName,
          createdNow: false,
        };
      }
    }
  }

  // 2. Procura se já existe um calendário secundário criado com o mesmo nome
  const listRes = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner&maxResults=50',
    { headers },
  );
  if (listRes.ok) {
    const listData = (await listRes.json()) as {
      items?: Array<{ id?: string; summary?: string; primary?: boolean }>;
    };
    const match = listData.items?.find(
      (c) => !c.primary && c.summary?.trim().toLowerCase() === params.calendarName.trim().toLowerCase() && c.id,
    );
    if (match?.id) {
      return {
        calendarId: match.id,
        calendarName: match.summary || params.calendarName,
        createdNow: false,
      };
    }
  }

  // 3. Cria o novo calendário separado exclusivo para finanças
  const createRes = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      summary: params.calendarName,
      description:
        'Calendário separado criado automaticamente pelo SuperFinance (escopo mínimo calendar.app.created) para alertas de contas, faturas e recorrências.',
      timeZone: params.timeZone,
    }),
  });
  const created = (await createRes.json().catch(() => ({}))) as {
    id?: string;
    summary?: string;
    error?: { message?: string };
  };
  if (!createRes.ok || !created.id) {
    throw new Error(created.error?.message || 'Não foi possível criar o calendário financeiro separado.');
  }
  return {
    calendarId: created.id,
    calendarName: created.summary || params.calendarName,
    createdNow: true,
  };
}

export async function listGoogleSecondaryEvents(params: {
  accessToken: string;
  calendarId: string;
}): Promise<CalendarEventItem[]> {
  const now = new Date();
  const minDt = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const maxDt = new Date(now.getTime() + 120 * 86_400_000).toISOString();

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`,
  );
  url.searchParams.set('timeMin', minDt);
  url.searchParams.set('timeMax', maxDt);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '50');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as {
    items?: CalendarEventItem[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message || 'Falha ao ler eventos do calendário financeiro.');
  }
  return Array.isArray(data.items) ? data.items : [];
}

export async function createGoogleSecondaryEvent(params: {
  accessToken: string;
  calendarId: string;
  timeZone: string;
  payload: CreateAlertPayload;
}): Promise<{ id?: string; htmlLink?: string; summary?: string }> {
  const { payload, timeZone } = params;
  const isRecurring = payload.recurringFreq && payload.recurringFreq !== 'NONE';
  const useAllDay = payload.allDay !== false && !isRecurring;

  const eventBody: Record<string, unknown> = {
    summary: payload.summary,
    description: payload.description || '',
    colorId: payload.colorId || '11',
  };

  if (useAllDay) {
    eventBody.start = { date: payload.date };
    eventBody.end = { date: addOneDay(payload.date) };
  } else {
    eventBody.start = { dateTime: `${payload.date}T09:00:00-03:00`, timeZone };
    eventBody.end = { dateTime: `${payload.date}T09:30:00-03:00`, timeZone };
  }

  if (isRecurring && payload.recurringFreq) {
    const dayOfMonth = Number(payload.date.split('-')[2]);
    eventBody.recurrence = [
      payload.recurringFreq === 'MONTHLY'
        ? `RRULE:FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`
        : `RRULE:FREQ=${payload.recurringFreq}`,
    ];
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events?sendUpdates=none`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    },
  );
  const created = (await res.json().catch(() => ({}))) as {
    id?: string;
    htmlLink?: string;
    summary?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(created.error?.message || 'Erro ao gravar evento no calendário financeiro.');
  }
  return created;
}
