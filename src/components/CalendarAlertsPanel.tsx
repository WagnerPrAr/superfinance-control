import { useMemo, type FormEvent } from 'react';
import {
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { getTodayIsoDate, subtractDaysFromIsoDate } from '../domain/ledger';
import { formatCentsBRL } from '../domain/money';
import type { CalendarEventItem, Transaction } from '../domain/types';
import {
  buildGoogleCalendarWebUrl,
  downloadBatchIcsFallback,
  downloadIcsFallback,
  type CalendarStatusResponse,
  type CreateAlertPayload,
} from '../services/calendarApi';
import { CollapsiblePanel } from './CollapsiblePanel';
import { usePersistedState } from '../hooks/usePersistedState';
import { AnimatedCurrency } from './AnimatedCurrency';

export interface SelectedAlertRequest {
  tx: Transaction;
  leadDays: number;
  alertDate: string;
}

interface CalendarAlertsPanelProps {
  status: CalendarStatusResponse | null;
  events: readonly CalendarEventItem[];
  transactions: readonly Transaction[];
  loadingEvents: boolean;
  creatingAlert: boolean;
  importantPendingTxs: readonly Transaction[];
  onRefresh: () => void;
  onCreateAlert: (payload: CreateAlertPayload, linkedTxId?: string) => Promise<void>;
  onBatchSyncAlerts: (items: readonly SelectedAlertRequest[]) => Promise<void>;
}

const LEAD_TIME_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: 'No dia marcado' },
  { days: 1, label: '1 dia antes' },
  { days: 2, label: '2 dias antes' },
  { days: 3, label: '3 dias antes' },
  { days: 5, label: '5 dias antes' },
  { days: 7, label: '1 semana antes' },
  { days: 15, label: '15 dias antes' },
];

const TX_TYPE_LABEL: Record<Transaction['type'], string> = {
  income: 'Entrada',
  expense: 'Saída',
  transfer: 'Transferência',
};

export function CalendarAlertsPanel({
  status,
  events,
  transactions,
  loadingEvents,
  creatingAlert,
  importantPendingTxs,
  onRefresh,
  onCreateAlert,
  onBatchSyncAlerts,
}: CalendarAlertsPanelProps) {
  const [summary, setSummary] = usePersistedState('sf_cal_draft_summary_v1', '');
  const [date, setDate] = usePersistedState('sf_cal_draft_date_v1', getTodayIsoDate());
  const [description, setDescription] = usePersistedState('sf_cal_draft_desc_v1', '');
  const [recurringFreq, setRecurringFreq] = usePersistedState<'NONE' | 'MONTHLY' | 'WEEKLY' | 'YEARLY'>(
    'sf_cal_draft_freq_v1',
    'NONE',
  );
  const [allDay, setAllDay] = usePersistedState('sf_cal_draft_allday_v1', true);

  // Estado persistido da lista de últimos lançamentos sem alerta no calendário
  const [selectedIdList, setSelectedIdList] = usePersistedState<string[]>('sf_cal_selected_ids_v1', []);
  const [defaultLeadDays, setDefaultLeadDays] = usePersistedState<number>('sf_cal_default_lead_v1', 1);
  const [leadDaysByTxId, setLeadDaysByTxId] = usePersistedState<Record<string, number>>('sf_cal_lead_map_v1', {});

  const selectedIds = useMemo(() => new Set(selectedIdList), [selectedIdList]);

  // Filtra os últimos lançamentos que ainda não possuem evento sincronizado no Google Calendar
  const unsyncedRecentTxs = useMemo(() => {
    const existingSummaries = events.map((ev) => (ev.summary || '').toLowerCase());
    return [...transactions]
      .filter((tx) => {
        if (tx.calendarEventId) return false;
        const descLower = tx.description.toLowerCase();
        const alreadyInRemote = existingSummaries.some((s) => s.includes(descLower));
        return !alreadyInRemote;
      })
      .sort((a, b) => {
        const byCreated = b.createdAtUtc.localeCompare(a.createdAtUtc);
        if (byCreated !== 0) return byCreated;
        return b.competenceDate.localeCompare(a.competenceDate);
      })
      .slice(0, 15);
  }, [transactions, events]);

  const activeSelectedIds = useMemo(() => {
    const visibleIds = new Set(unsyncedRecentTxs.map((t) => t.id));
    const valid = new Set<string>();
    for (const id of selectedIds) {
      if (visibleIds.has(id)) valid.add(id);
    }
    return valid;
  }, [selectedIds, unsyncedRecentTxs]);

  const allSelected = unsyncedRecentTxs.length > 0 && activeSelectedIds.size === unsyncedRecentTxs.length;

  function getLeadDays(txId: string): number {
    return leadDaysByTxId[txId] ?? defaultLeadDays;
  }

  function toggleSelect(txId: string) {
    setSelectedIdList((prev) =>
      prev.includes(txId) ? prev.filter((id) => id !== txId) : [...prev, txId],
    );
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIdList([]);
    } else {
      setSelectedIdList(unsyncedRecentTxs.map((t) => t.id));
    }
  }

  function handleApplyDefaultLead(days: number) {
    setDefaultLeadDays(days);
    setLeadDaysByTxId((prev) => {
      const next = { ...prev };
      for (const id of activeSelectedIds) {
        next[id] = days;
      }
      return next;
    });
  }

  function buildSelectedRequests(): SelectedAlertRequest[] {
    return unsyncedRecentTxs
      .filter((tx) => activeSelectedIds.has(tx.id))
      .map((tx) => {
        const leadDays = getLeadDays(tx.id);
        return {
          tx,
          leadDays,
          alertDate: subtractDaysFromIsoDate(tx.competenceDate, leadDays),
        };
      });
  }

  async function handleSyncSelected() {
    const items = buildSelectedRequests();
    if (items.length === 0) return;

    if (status?.connected) {
      await onBatchSyncAlerts(items);
      setSelectedIdList([]);
    } else {
      downloadBatchIcsFallback(
        items.map(({ tx, leadDays, alertDate }) => ({
          uid: `tx-${tx.id}-${alertDate}`,
          summary:
            leadDays > 0
              ? `[SuperFinance] Lembrete (${leadDays}d antes): ${tx.description} (${formatCentsBRL(tx.amountCents)})`
              : `[SuperFinance] ${tx.description} (${formatCentsBRL(tx.amountCents)})`,
          description: `Lançamento: ${tx.description}\nCategoria: ${tx.category}\nData marcada: ${tx.competenceDate}\nAntecedência: ${leadDays === 0 ? 'No dia' : `${leadDays} dia(s) antes`}\nValor: ${formatCentsBRL(tx.amountCents)}`,
          date: alertDate,
          alarmDaysBefore: 0,
        })),
      );
      await onBatchSyncAlerts(items);
      setSelectedIdList([]);
    }
  }

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
      {/* Banner de isolamento do calendário + botão de sincronização */}
      <div
        className="surface"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
      >
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
                {status?.connected ? 'Conectado (Calendário Separado)' : 'Modo Web / .ics'}
              </span>
            </div>
            <p className="section-desc" style={{ marginTop: 4 }}>
              {status?.connected
                ? `Isolado da sua agenda pessoal • Fuso ${status.timeZone} • Alertas sincronizados diretamente via API local.`
                : 'Selecione os lançamentos abaixo para gerar o pacote .ics ou agendar direto no Google Calendar Web.'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={loadingEvents}>
            <RefreshCw size={14} />
            {loadingEvents ? 'Sincronizando...' : 'Sincronizar Agenda'}
          </button>
        </div>
      </div>

      {/* NOVO: Últimos lançamentos sem alerta no Google Calendar */}
      <div className="surface">
        <div className="section-header" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 className="section-title">Últimos Lançamentos fora do Calendário</h3>
            <p className="section-desc">
              Marque os lançamentos desejados, defina a antecedência de cada alerta e clique em sincronizar.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-secondary)' }}>
              <Clock size={14} />
              <span>Padrão:</span>
              <select
                aria-label="Antecedência padrão dos alertas"
                className="select"
                style={{ padding: '6px 10px', fontSize: 12.5 }}
                value={defaultLeadDays}
                onChange={(e) => handleApplyDefaultLead(Number(e.target.value))}
              >
                {LEAD_TIME_OPTIONS.map((opt) => (
                  <option key={opt.days} value={opt.days}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              id="btn-sync-selected-alerts"
              className="btn btn-navy btn-sm"
              disabled={creatingAlert || activeSelectedIds.size === 0}
              onClick={() => void handleSyncSelected()}
            >
              <RefreshCw size={14} />
              {creatingAlert
                ? 'Sincronizando...'
                : status?.connected
                  ? `Sincronizar no Google Calendar (${activeSelectedIds.size})`
                  : `Sincronizar / Exportar .ics (${activeSelectedIds.size})`}
            </button>
          </div>
        </div>

        {unsyncedRecentTxs.length === 0 ? (
          <p className="section-desc">
            Todos os lançamentos recentes já estão sincronizados com o Google Calendar!
          </p>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 0 10px',
                borderBottom: '1px solid var(--border-strong)',
                fontSize: 12.5,
                color: 'var(--ink-secondary)',
              }}
            >
              <label className="checkbox-row" style={{ fontSize: 12.5, fontWeight: 600 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                Selecionar todos ({unsyncedRecentTxs.length} lançamento(s) sem alerta)
              </label>
              <span>{activeSelectedIds.size} selecionado(s)</span>
            </div>

            <div className="list-stack">
              {unsyncedRecentTxs.map((tx) => {
                const isChecked = activeSelectedIds.has(tx.id);
                const leadDays = getLeadDays(tx.id);
                const alertDate = subtractDaysFromIsoDate(tx.competenceDate, leadDays);

                return (
                  <div
                    key={tx.id}
                    className="list-row"
                    style={{
                      background: isChecked ? 'rgba(36, 86, 122, 0.045)' : 'transparent',
                      padding: '12px 10px',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelect(tx.id)}
                        aria-label={`Selecionar ${tx.description}`}
                        style={{ marginTop: 4, width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <div className="list-row-main">
                        <div className="list-row-title">
                          {tx.description}
                          <span
                            className={`tag ${
                              tx.type === 'income'
                                ? 'tag-emerald'
                                : tx.type === 'expense'
                                  ? 'tag-terracotta'
                                  : 'tag-navy'
                            }`}
                          >
                            {TX_TYPE_LABEL[tx.type]}
                          </span>
                          {tx.important && <span className="tag tag-amber">Importante</span>}
                        </div>
                        <div className="list-row-sub">
                          <span className="mono">Data marcada: {tx.competenceDate}</span>
                          <span>•</span>
                          <span>{tx.category}</span>
                          <span>•</span>
                          <span className="mono text-navy" style={{ fontWeight: 600 }}>
                            Alerta em: {alertDate}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="list-row-right" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span
                        className={`mono ${
                          tx.type === 'income'
                            ? 'text-emerald'
                            : tx.type === 'expense'
                              ? 'text-terracotta'
                              : 'text-navy'
                        }`}
                        style={{ fontWeight: 700, minWidth: 100, textAlign: 'right' }}
                      >
                        {formatCentsBRL(tx.amountCents)}
                      </span>

                      <select
                        aria-label={`Antecedência do alerta para ${tx.description}`}
                        className="select"
                        style={{ padding: '6px 10px', fontSize: 12.5 }}
                        value={leadDays}
                        onChange={(e) => {
                          const days = Number(e.target.value);
                          setLeadDaysByTxId((prev) => ({ ...prev, [tx.id]: days }));
                          if (!isChecked) toggleSelect(tx.id);
                        }}
                      >
                        {LEAD_TIME_OPTIONS.map((opt) => (
                          <option key={opt.days} value={opt.days}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      {!status?.connected && (
                        <a
                          className="btn btn-sm"
                          title="Abrir este alerta diretamente no Google Calendar Web"
                          href={buildGoogleCalendarWebUrl({
                            summary:
                              leadDays > 0
                                ? `[SuperFinance] Lembrete (${leadDays}d antes): ${tx.description} (${formatCentsBRL(tx.amountCents)})`
                                : `[SuperFinance] ${tx.description} (${formatCentsBRL(tx.amountCents)})`,
                            date: alertDate,
                            description: `Lançamento: ${tx.description}\nCategoria: ${tx.category}\nData marcada: ${tx.competenceDate}\nValor: ${formatCentsBRL(tx.amountCents)}`,
                          })}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={13} />
                          Web
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Formulário de Alerta sob Demanda (recolhido por padrão para tela limpa) */}
        <CollapsiblePanel
          title="Criar Alerta sob Demanda"
          subtitle="Agende um lembrete único ou recorrente manualmente"
          indexLabel="01/"
          storageKey="sf_panel_cal_manual_v1"
          defaultOpen={false}
          summary={<span className="tag">Manual</span>}
        >
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
        </CollapsiblePanel>

        {/* Contas Importantes Pendentes (resumido com badge) */}
        <CollapsiblePanel
          title="Contas Importantes Pendentes"
          subtitle="Atalho rápido para contas críticas ainda não quitadas"
          indexLabel="02/"
          storageKey="sf_panel_cal_important_v1"
          defaultOpen={false}
          summary={<span className="tag tag-amber">{importantPendingTxs.length} pendentes</span>}
        >
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
                      <AnimatedCurrency cents={tx.amountCents} mode="count" durationMs={700} />
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
        </CollapsiblePanel>

        {/* Eventos Reais Sincronizados no Google Calendar */}
        <CollapsiblePanel
          title="Eventos no Google Calendar"
          subtitle="Leitura direta do calendário financeiro (próximos 120 dias)"
          indexLabel="03/"
          storageKey="sf_panel_cal_events_v1"
          defaultOpen={events.length > 0}
          summary={
            <span className="tag tag-navy">
              <Calendar size={12} /> {events.length} eventos
            </span>
          }
        >
          {events.length === 0 ? (
            <p className="section-desc">
              Nenhum alerta listado no calendário remoto. Selecione lançamentos acima e clique em "Sincronizar" para enviar novos alertas.
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
        </CollapsiblePanel>
      </div>
    </div>
  );
}
