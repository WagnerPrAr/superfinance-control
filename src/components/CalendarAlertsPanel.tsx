import { useState, type FormEvent } from 'react';
import { Bell, Calendar, CheckCircle2, Download, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { getTodayIsoDate } from '../domain/ledger';
import { formatCentsBRL } from '../domain/money';
import type { CalendarEventItem, Transaction } from '../domain/types';
import {
  buildGoogleCalendarWebUrl,
  downloadIcsFallback,
  type CalendarStatusResponse,
  type CreateAlertPayload,
} from '../services/calendarApi';

interface CalendarAlertsPanelProps {
  status: CalendarStatusResponse | null;
  events: readonly CalendarEventItem[];
  loadingEvents: boolean;
  creatingAlert: boolean;
  importantPendingTxs: readonly Transaction[];
  onRefresh: () => void;
  onCreateAlert: (payload: CreateAlertPayload, linkedTxId?: string) => Promise<void>;
}

export function CalendarAlertsPanel({
  status,
  events,
  loadingEvents,
  creatingAlert,
  importantPendingTxs,
  onRefresh,
  onCreateAlert,
}: CalendarAlertsPanelProps) {
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(getTodayIsoDate());
  const [description, setDescription] = useState('');
  const [recurringFreq, setRecurringFreq] = useState<'NONE' | 'MONTHLY' | 'WEEKLY' | 'YEARLY'>('NONE');
  const [allDay, setAllDay] = useState(true);

  async function handleCustomSubmit(e: FormEvent) {
    e.preventDefault();
    if (!summary.trim()) return;
    await onCreateAlert({
      summary: summary.trim(),
      date,
      description: description.trim() || 'Alerta criado manualmente pelo SuperFinance.',
      recurringFreq,
      allDay,
      colorId: '11',
    });
    setSummary('');
    setDescription('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Banner de isolamento do calendário */}
      <div className="surface" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: status?.connected ? 'var(--accent-emerald-soft)' : 'var(--accent-amber-soft)',
              color: status?.connected ? 'var(--accent-emerald)' : 'var(--accent-amber)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 className="section-title">
                {status?.calendarName || 'SuperFinance — Alertas Financeiros (Teste)'}
              </h2>
              <span className={`tag ${status?.connected ? 'tag-emerald' : 'tag-amber'}`}>
                {status?.connected ? 'Conectado (Calendário Separado)' : 'Modo Offline (.ics)'}
              </span>
            </div>
            <p className="section-desc" style={{ marginTop: 4 }}>
              {status?.connected
                ? `Isolado da sua agenda pessoal • Fuso ${status.timeZone} • Notificações criadas sem enviar convites a terceiros.`
                : status?.message || 'Inicie via servidor local Vite para sincronizar direto com o Google Calendar ou use exportação .ics.'}
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={loadingEvents}>
          <RefreshCw size={14} />
          {loadingEvents ? 'Sincronizando...' : 'Atualizar Agenda'}
        </button>
      </div>

      <div className="grid-equal">
        {/* Formulário de Alerta sob Demanda */}
        <div className="surface">
          <div className="section-header">
            <div>
              <h3 className="section-title">Criar Alerta sob Demanda</h3>
              <p className="section-desc">Agende um lembrete único ou recorrente no calendário financeiro</p>
            </div>
          </div>

          <form onSubmit={handleCustomSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div className="field">
              <label htmlFor="cal-summary">Título do Alerta</label>
              <input
                id="cal-summary"
                className="input"
                placeholder="Ex.: Pagar IPVA, Revisar fatura Ultravioleta..."
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
              />
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="cal-date">Data do Alerta</label>
                <input
                  id="cal-date"
                  type="date"
                  className="input mono"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="cal-freq">Recorrência</label>
                <select
                  id="cal-freq"
                  className="select"
                  value={recurringFreq}
                  onChange={(e) => setRecurringFreq(e.target.value as 'NONE' | 'MONTHLY' | 'WEEKLY' | 'YEARLY')}
                >
                  <option value="NONE">Evento único</option>
                  <option value="MONTHLY">Mensal (todo mês)</option>
                  <option value="WEEKLY">Semanal</option>
                  <option value="YEARLY">Anual</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="cal-desc">Observações (opcional)</label>
              <input
                id="cal-desc"
                className="input"
                placeholder="Valor estimado, conta para débito, código de barras..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {recurringFreq === 'NONE' && (
              <label className="checkbox-row">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
                Evento de dia inteiro (desmarque para agendar às 09:00 BRT)
              </label>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
              {status?.connected ? (
                <button type="submit" className="btn btn-navy" disabled={creatingAlert}>
                  <Bell size={15} />
                  {creatingAlert ? 'Agendando...' : 'Enviar para Google Calendar'}
                </button>
              ) : (
                <a
                  className="btn btn-navy"
                  href={buildGoogleCalendarWebUrl({
                    summary: summary.trim() || '[SuperFinance] Lembrete Financeiro',
                    description: description.trim() || 'Alerta financeiro criado pelo SuperFinance.',
                    date,
                  })}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} />
                  Agendar no Google Calendar (Web)
                </a>
              )}
              <button
                type="button"
                className="btn"
                onClick={() =>
                  downloadIcsFallback({
                    uid: `manual-${Date.now()}`,
                    summary: summary.trim() || 'Lembrete SuperFinance',
                    description: description.trim() || 'Alerta financeiro gerado pelo SuperFinance.',
                    date,
                  })
                }
              >
                <Download size={15} />
                Baixar .ics
              </button>
            </div>
          </form>
        </div>

        {/* Contas Importantes Pendentes */}
        <div className="surface">
          <div className="section-header">
            <div>
              <h3 className="section-title">Contas Importantes Pendentes</h3>
              <p className="section-desc">Dispare notificações com 1 clique no calendário separado</p>
            </div>
            <span className="tag tag-amber">{importantPendingTxs.length} pendentes</span>
          </div>

          {importantPendingTxs.length === 0 ? (
            <p className="section-desc">Nenhuma conta importante pendente no momento.</p>
          ) : (
            <div className="list-stack">
              {importantPendingTxs.slice(0, 6).map((tx) => (
                <div key={tx.id} className="list-row">
                  <div className="list-row-main">
                    <div className="list-row-title">
                      {tx.description}
                      {tx.calendarEventId && (
                        <span className="tag tag-emerald">
                          <CheckCircle2 size={11} /> Agendado
                        </span>
                      )}
                    </div>
                    <div className="list-row-sub">
                      <span className="mono">Venc. {tx.competenceDate}</span>
                      <span>•</span>
                      <span>{tx.category}</span>
                    </div>
                  </div>
                  <div className="list-row-right">
                    <span className="mono text-terracotta" style={{ fontWeight: 600 }}>
                      {formatCentsBRL(tx.amountCents)}
                    </span>
                    {tx.calendarEventLink ? (
                      <a
                        href={tx.calendarEventLink}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-sm"
                      >
                        <ExternalLink size={13} />
                        Ver
                      </a>
                    ) : status?.connected ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-navy"
                        disabled={creatingAlert}
                        onClick={() =>
                          onCreateAlert(
                            {
                              summary: `[SuperFinance] Pagar ${tx.description} (${formatCentsBRL(tx.amountCents)})`,
                              date: tx.competenceDate,
                              description: `Categoria: ${tx.category}\nValor exato: ${formatCentsBRL(tx.amountCents)}\nStatus no SuperFinance: Pendente`,
                              allDay: true,
                              colorId: '11',
                            },
                            tx.id,
                          )
                        }
                      >
                        <Bell size={13} />
                        Alertar
                      </button>
                    ) : (
                      <a
                        className="btn btn-sm btn-navy"
                        href={buildGoogleCalendarWebUrl({
                          summary: `[SuperFinance] Pagar ${tx.description} (${formatCentsBRL(tx.amountCents)})`,
                          date: tx.competenceDate,
                          description: `Categoria: ${tx.category}\nValor exato: ${formatCentsBRL(tx.amountCents)}\nStatus no SuperFinance: Pendente`,
                        })}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={13} />
                        Calendar
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Eventos Reais Sincronizados no Google Calendar */}
      <div className="surface">
        <div className="section-header">
          <div>
            <h3 className="section-title">Eventos no Google Calendar (Calendário Separado)</h3>
            <p className="section-desc">Leitura direta do calendário financeiro para os próximos 120 dias</p>
          </div>
          <span className="tag tag-navy">
            <Calendar size={12} /> {events.length} eventos
          </span>
        </div>

        {events.length === 0 ? (
          <p className="section-desc">
            Nenhum alerta agendado neste calendário ainda. Clique em "Alertar" em qualquer conta importante acima para testar a integração ao vivo.
          </p>
        ) : (
          <div className="list-stack">
            {events.map((ev) => {
              const startLabel = ev.start?.date || ev.start?.dateTime?.slice(0, 16).replace('T', ' ') || '—';
              return (
                <div key={ev.id} className="list-row">
                  <div className="list-row-main">
                    <div className="list-row-title">{ev.summary}</div>
                    <div className="list-row-sub">
                      <span className="mono">{startLabel}</span>
                      {ev.description && <span>• {ev.description.split('\n')[0]}</span>}
                    </div>
                  </div>
                  {ev.htmlLink && (
                    <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="btn btn-sm">
                      <ExternalLink size={13} />
                      Abrir no Calendar
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
