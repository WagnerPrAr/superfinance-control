import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const execFileAsync = promisify(execFile);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_FREQS = new Set(['NONE', 'MONTHLY', 'WEEKLY', 'YEARLY']);
const ALLOWED_COLORS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);

interface CalendarConfig {
  calendarId: string;
  calendarName: string;
  timeZone: string;
}

function sanitizeSingleLine(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[\r\n\t\x00-\x1f]/g, ' ').trim().slice(0, maxLen);
}

function sanitizeMultiline(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, maxLen);
}

async function runGcalendar(args: string[]): Promise<string> {
  // Segurança (GOVERNANCA_SKILLS.md): shell: false + argv estrito (zero command injection)
  const { stdout } = await execFileAsync('gcalendar', args, {
    shell: false,
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout.trim();
}

function addOneDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function addDaysFromToday(days: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function ensureDedicatedCalendar(config: CalendarConfig): Promise<CalendarConfig> {
  if (config.calendarId && config.calendarId !== 'primary') {
    return config;
  }
  const out = await runGcalendar([
    'mutate',
    'create-calendar',
    '--summary',
    config.calendarName,
    '--description',
    'Calendário separado criado pelo SuperFinance para alertas de contas, faturas e dívidas recorrentes.',
    '--timezone',
    config.timeZone,
    '--if-missing',
    '--json',
  ]);
  const parsed = JSON.parse(out) as { id?: string; summary?: string };
  if (!parsed.id) {
    throw new Error('Não foi possível obter o ID do calendário secundário.');
  }
  return {
    calendarId: parsed.id,
    calendarName: parsed.summary || config.calendarName,
    timeZone: config.timeZone,
  };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 64 * 1024) {
      throw new Error('Payload excede o limite de 64KB.');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

export function gcalendarBridgePlugin(initialConfig: CalendarConfig): Plugin {
  let cachedConfig: CalendarConfig = { ...initialConfig };

  return {
    name: 'superfinance-gcalendar-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/calendar')) {
          return next();
        }

        try {
          if (req.method === 'GET' && url === '/api/calendar/status') {
            const { stdout, stderr } = await execFileAsync('gcalendar', ['auth', 'status'], {
              shell: false,
              timeout: 10000,
            });
            const combined = `${stdout}\n${stderr}`;
            const loggedIn = /logged in/i.test(combined);
            if (!loggedIn) {
              return sendJson(res, 200, {
                connected: false,
                calendarId: null,
                calendarName: cachedConfig.calendarName,
                timeZone: cachedConfig.timeZone,
                message: 'Google Calendar CLI não autenticado.',
              });
            }
            cachedConfig = await ensureDedicatedCalendar(cachedConfig);
            return sendJson(res, 200, {
              connected: true,
              calendarId: cachedConfig.calendarId,
              calendarName: cachedConfig.calendarName,
              timeZone: cachedConfig.timeZone,
              isolatedFromPersonal: true,
            });
          }

          if (req.method === 'GET' && url === '/api/calendar/events') {
            cachedConfig = await ensureDedicatedCalendar(cachedConfig);
            const start = `${addDaysFromToday(-7)}T00:00:00Z`;
            const end = `${addDaysFromToday(120)}T23:59:59Z`;
            const raw = await runGcalendar([
              'readonly',
              'events',
              '--cal',
              cachedConfig.calendarId,
              '--start',
              start,
              '--end',
              end,
              '--max',
              '50',
              '--json',
            ]);
            const events = raw && raw !== 'null' ? JSON.parse(raw) : [];
            return sendJson(res, 200, {
              calendarId: cachedConfig.calendarId,
              calendarName: cachedConfig.calendarName,
              events: Array.isArray(events) ? events : [],
            });
          }

          if (req.method === 'POST' && url === '/api/calendar/alert') {
            const body = await readJsonBody(req);
            const summary = sanitizeSingleLine(body.summary, 160);
            const date = sanitizeSingleLine(body.date, 10);
            const description = sanitizeMultiline(body.description, 1500);
            const recurringFreq = sanitizeSingleLine(body.recurringFreq || 'NONE', 16).toUpperCase();
            const colorId = sanitizeSingleLine(body.colorId || '11', 4);
            const allDay = body.allDay !== false;

            if (!summary) {
              return sendJson(res, 400, { error: 'Campo "summary" é obrigatório.' });
            }
            if (!ISO_DATE_RE.test(date)) {
              return sendJson(res, 400, { error: 'Campo "date" deve estar no formato YYYY-MM-DD.' });
            }
            if (!ALLOWED_FREQS.has(recurringFreq)) {
              return sendJson(res, 400, { error: 'Frequência de recorrência inválida.' });
            }

            cachedConfig = await ensureDedicatedCalendar(cachedConfig);
            let output = '';

            if (recurringFreq !== 'NONE') {
              const dayOfMonth = Number(date.split('-')[2]);
              const rrule =
                recurringFreq === 'MONTHLY'
                  ? `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`
                  : `FREQ=${recurringFreq}`;

              const startIso = `${date}T09:00:00-03:00`;
              const endIso = `${date}T09:30:00-03:00`;
              const args = [
                'mutate',
                'recurring',
                summary,
                '--cal',
                cachedConfig.calendarId,
                '--start',
                startIso,
                '--end',
                endIso,
                '--rrule',
                rrule,
                '--send-updates',
                'none',
                '--timezone',
                cachedConfig.timeZone,
                '--json',
              ];
              if (description) {
                args.push('--description', description);
              }
              output = await runGcalendar(args);
            } else {
              const args = [
                'mutate',
                'create',
                '--cal',
                cachedConfig.calendarId,
                '--summary',
                summary,
                '--send-updates',
                'none',
                '--timezone',
                cachedConfig.timeZone,
                '--json',
              ];

              if (allDay) {
                args.push('--all-day', '--start', date, '--end', addOneDay(date));
              } else {
                args.push('--start', `${date}T09:00:00-03:00`, '--end', `${date}T09:30:00-03:00`);
              }

              if (description) {
                args.push('--description', description);
              }
              if (ALLOWED_COLORS.has(colorId)) {
                args.push('--color', colorId);
              }
              output = await runGcalendar(args);
            }

            const parsed = output ? JSON.parse(output) : {};
            return sendJson(res, 201, {
              created: true,
              calendarId: cachedConfig.calendarId,
              calendarName: cachedConfig.calendarName,
              event: parsed,
            });
          }

          return sendJson(res, 404, { error: 'Endpoint de calendário não encontrado.' });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erro interno ao comunicar com Google Calendar.';
          return sendJson(res, 500, { error: message });
        }
      });
    },
  };
}
