import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarClock,
  Check,
  CreditCard as CreditCardIcon,
  Landmark,
  LayoutDashboard,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { buildInitialSeedState } from './data/seedData';
import {
  computeAccountBalanceCents,
  computeCardStatementCents,
  computeCardUsedLimitCents,
  generateRecurringTransactionsForPeriod,
  getCardStatementDueDate,
  getCurrentYearMonth,
  shiftYearMonth,
} from './domain/ledger';
import { addCents, formatCentsBRL, parseBRLToCents, subtractCents, sumCents } from './domain/money';
import type {
  Account,
  AccountType,
  CalendarEventItem,
  CreditCard,
  FinanceState,
  RecurrenceFrequency,
  RecurrenceRule,
  Transaction,
} from './domain/types';
import {
  createCalendarAlert,
  fetchCalendarEvents,
  fetchCalendarStatus,
  type CalendarStatusResponse,
  type CreateAlertPayload,
} from './services/calendarApi';
import { CashflowChart } from './components/CashflowChart';
import { NewTransactionModal } from './components/NewTransactionModal';
import { CalendarAlertsPanel, type SelectedAlertRequest } from './components/CalendarAlertsPanel';

type NavTab = 'overview' | 'accounts' | 'cards' | 'transactions' | 'recurrences' | 'calendar';

const STORAGE_KEY = 'superfinance_state_v1';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Conta Corrente',
  savings: 'Poupança / Reserva',
  cash: 'Dinheiro',
  investment: 'Investimentos',
};

const FREQ_LABELS: Record<RecurrenceFrequency, string> = {
  monthly: 'Mensal',
  weekly: 'Semanal',
  yearly: 'Anual',
};

function loadInitialState(): FinanceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FinanceState;
      if (parsed && Array.isArray(parsed.accounts) && Array.isArray(parsed.transactions)) {
        return parsed;
      }
    }
  } catch {
    // Fallback para dados iniciais
  }
  return buildInitialSeedState();
}

export function App() {
  const [state, setState] = useState<FinanceState>(loadInitialState);
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [currentYm, setCurrentYm] = useState<string>(getCurrentYearMonth);
  const [showNewTxModal, setShowNewTxModal] = useState(false);

  // Filtros de Lançamentos
  const [txFilterType, setTxFilterType] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [txFilterStatus, setTxFilterStatus] = useState<'all' | 'paid' | 'pending'>('all');
  const [txSearch, setTxSearch] = useState('');

  // Formulário rápido de Conta
  const [newAccName, setNewAccName] = useState('');
  const [newAccInst, setNewAccInst] = useState('');
  const [newAccType, setNewAccType] = useState<AccountType>('checking');
  const [newAccBalance, setNewAccBalance] = useState('');

  // Formulário rápido de Cartão
  const [newCardName, setNewCardName] = useState('');
  const [newCardIssuer, setNewCardIssuer] = useState('');
  const [newCardLast4, setNewCardLast4] = useState('');
  const [newCardLimit, setNewCardLimit] = useState('');
  const [newCardClosing, setNewCardClosing] = useState(20);
  const [newCardDue, setNewCardDue] = useState(28);

  // Formulário rápido de Recorrência
  const [newRecTitle, setNewRecTitle] = useState('');
  const [newRecCategory, setNewRecCategory] = useState('Contas Fixas');
  const [newRecAmount, setNewRecAmount] = useState('');
  const [newRecType, setNewRecType] = useState<'expense' | 'income'>('expense');
  const [newRecFreq, setNewRecFreq] = useState<RecurrenceFrequency>('monthly');
  const [newRecDay, setNewRecDay] = useState(10);
  const [newRecImportant, setNewRecImportant] = useState(true);

  // Google Calendar Bridge State
  const [calStatus, setCalStatus] = useState<CalendarStatusResponse | null>(null);
  const [calEvents, setCalEvents] = useState<CalendarEventItem[]>([]);
  const [loadingCal, setLoadingCal] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; link?: string } | null>(null);

  const showToast = useCallback((message: string, link?: string) => {
    setToast({ message, link });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignora quota errors
    }
  }, [state]);

  const refreshCalendar = useCallback(async () => {
    setLoadingCal(true);
    try {
      const st = await fetchCalendarStatus();
      setCalStatus(st);
      if (st.connected) {
        const ev = await fetchCalendarEvents();
        setCalEvents(ev.events);
      }
    } catch {
      setCalStatus({
        connected: false,
        calendarId: null,
        calendarName: 'SuperFinance — Alertas Financeiros (Teste)',
        timeZone: 'America/Sao_Paulo',
        message: 'Bridge local não detectada (use exportação .ics ou execute via Vite dev server).',
      });
    } finally {
      setLoadingCal(false);
    }
  }, []);

  useEffect(() => {
    void refreshCalendar();
  }, [refreshCalendar]);

  // Cálculos derivados (100% em centavos inteiros)
  const accountBalances = useMemo(() => {
    const map = new Map<string, number>();
    for (const acc of state.accounts) {
      map.set(acc.id, computeAccountBalanceCents(acc, state.transactions));
    }
    return map;
  }, [state.accounts, state.transactions]);

  const totalAccountsBalanceCents = useMemo(
    () => sumCents(Array.from(accountBalances.values())),
    [accountBalances],
  );

  const totalOpenCardsCents = useMemo(
    () => sumCents(state.cards.map((c) => computeCardUsedLimitCents(c.id, state.transactions))),
    [state.cards, state.transactions],
  );

  const netWorthCents = subtractCents(totalAccountsBalanceCents, totalOpenCardsCents);

  const monthIncomeCents = useMemo(
    () =>
      sumCents(
        state.transactions
          .filter((tx) => tx.type === 'income' && tx.competenceDate.startsWith(currentYm))
          .map((tx) => tx.amountCents),
      ),
    [state.transactions, currentYm],
  );

  const monthExpenseCents = useMemo(
    () =>
      sumCents(
        state.transactions
          .filter((tx) => tx.type === 'expense' && tx.competenceDate.startsWith(currentYm))
          .map((tx) => tx.amountCents),
      ),
    [state.transactions, currentYm],
  );

  const monthResultCents = subtractCents(monthIncomeCents, monthExpenseCents);

  const importantPendingTxs = useMemo(
    () =>
      state.transactions
        .filter((tx) => tx.status === 'pending' && tx.type === 'expense' && (tx.important || tx.recurrenceRuleId))
        .sort((a, b) => a.competenceDate.localeCompare(b.competenceDate)),
    [state.transactions],
  );

  const categoryBreakdown = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const tx of state.transactions) {
      if (tx.type !== 'expense' || !tx.competenceDate.startsWith(currentYm)) continue;
      byCat.set(tx.category, addCents(byCat.get(tx.category) ?? 0, tx.amountCents));
    }
    return Array.from(byCat.entries())
      .map(([category, cents]) => ({ category, cents }))
      .sort((a, b) => b.cents - a.cents);
  }, [state.transactions, currentYm]);

  const filteredTransactions = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return state.transactions
      .filter((tx) => (txFilterType === 'all' ? true : tx.type === txFilterType))
      .filter((tx) => (txFilterStatus === 'all' ? true : tx.status === txFilterStatus))
      .filter((tx) =>
        q ? tx.description.toLowerCase().includes(q) || tx.category.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => b.competenceDate.localeCompare(a.competenceDate));
  }, [state.transactions, txFilterType, txFilterStatus, txSearch]);

  // Ações
  const handleCreateCalendarAlert = useCallback(
    async (payload: CreateAlertPayload, linkedTxId?: string) => {
      setCreatingAlert(true);
      try {
        const resp = await createCalendarAlert(payload);
        if (linkedTxId && resp.event?.id) {
          setState((prev) => ({
            ...prev,
            transactions: prev.transactions.map((tx) =>
              tx.id === linkedTxId
                ? { ...tx, calendarEventId: resp.event.id, calendarEventLink: resp.event.htmlLink }
                : tx,
            ),
          }));
        }
        showToast(
          `Alerta criado em "${resp.calendarName}"!`,
          resp.event?.htmlLink,
        );
        await refreshCalendar();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Erro ao criar alerta no Google Calendar.');
      } finally {
        setCreatingAlert(false);
      }
    },
    [refreshCalendar, showToast],
  );

  const handleBatchSyncAlerts = useCallback(
    async (items: readonly SelectedAlertRequest[]) => {
      if (items.length === 0) return;
      if (!calStatus?.connected) {
        const exportedIds = new Set(items.map((i) => i.tx.id));
        setState((prev) => ({
          ...prev,
          transactions: prev.transactions.map((tx) =>
            exportedIds.has(tx.id) ? { ...tx, calendarEventId: `ics-${Date.now()}` } : tx,
          ),
        }));
        showToast(
          `Arquivo .ics com ${items.length} alerta(s) gerado! Importe no Google Calendar ou sincronize via bridge local.`,
        );
        return;
      }

      setCreatingAlert(true);
      try {
        const syncedMap = new Map<string, { id: string; link?: string }>();
        for (const { tx, leadDays, alertDate } of items) {
          const summary =
            leadDays > 0
              ? `[SuperFinance] Lembrete (${leadDays}d antes): ${tx.description} (${formatCentsBRL(tx.amountCents)})`
              : `[SuperFinance] ${tx.description} (${formatCentsBRL(tx.amountCents)})`;
          const resp = await createCalendarAlert({
            summary,
            date: alertDate,
            description: `Lançamento: ${tx.description}\nCategoria: ${tx.category}\nData marcada: ${tx.competenceDate}\nAntecedência: ${leadDays === 0 ? 'No dia' : `${leadDays} dia(s) antes`}\nValor: ${formatCentsBRL(tx.amountCents)}`,
            allDay: true,
            colorId: tx.type === 'income' ? '10' : '11',
          });
          if (resp.event?.id) {
            syncedMap.set(tx.id, { id: resp.event.id, link: resp.event.htmlLink });
          }
        }

        if (syncedMap.size > 0) {
          setState((prev) => ({
            ...prev,
            transactions: prev.transactions.map((tx) => {
              const info = syncedMap.get(tx.id);
              return info ? { ...tx, calendarEventId: info.id, calendarEventLink: info.link } : tx;
            }),
          }));
        }
        showToast(`${syncedMap.size} alerta(s) sincronizado(s) com o Google Calendar!`);
        await refreshCalendar();
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Erro ao sincronizar alertas selecionados.');
      } finally {
        setCreatingAlert(false);
      }
    },
    [calStatus?.connected, refreshCalendar, showToast],
  );

  function handleSaveNewTransactions(newTxs: Transaction[], scheduleAlert: boolean) {
    setState((prev) => ({
      ...prev,
      transactions: [...newTxs, ...prev.transactions],
    }));
    setShowNewTxModal(false);
    showToast(
      newTxs.length > 1
        ? `${newTxs.length} parcelas registradas com precisão em centavos.`
        : 'Lançamento registrado com sucesso.',
    );

    if (scheduleAlert && newTxs[0]) {
      const first = newTxs[0];
      void handleCreateCalendarAlert(
        {
          summary: `[SuperFinance] ${first.description} (${formatCentsBRL(first.amountCents)})`,
          date: first.competenceDate,
          description: `Categoria: ${first.category}\nValor: ${formatCentsBRL(first.amountCents)}`,
          allDay: true,
          colorId: '11',
        },
        first.id,
      );
    }
  }

  function handleToggleTxStatus(id: string) {
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.map((tx) =>
        tx.id === id ? { ...tx, status: tx.status === 'paid' ? 'pending' : 'paid' } : tx,
      ),
    }));
  }

  function handleDeleteTx(id: string) {
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((tx) => tx.id !== id),
    }));
    showToast('Lançamento removido.');
  }

  function handleAddAccount(e: FormEvent) {
    e.preventDefault();
    if (!newAccName.trim()) return;
    const acc: Account = {
      id: `acc-${Date.now()}`,
      name: newAccName.trim(),
      institution: newAccInst.trim() || 'Banco',
      type: newAccType,
      initialBalanceCents: parseBRLToCents(newAccBalance),
      accentColor: '#0F6E56',
    };
    setState((prev) => ({ ...prev, accounts: [...prev.accounts, acc] }));
    setNewAccName('');
    setNewAccInst('');
    setNewAccBalance('');
    showToast(`Conta "${acc.name}" adicionada.`);
  }

  function handleAddCard(e: FormEvent) {
    e.preventDefault();
    const limitCents = parseBRLToCents(newCardLimit);
    if (!newCardName.trim() || limitCents <= 0) return;
    const card: CreditCard = {
      id: `card-${Date.now()}`,
      name: newCardName.trim(),
      issuer: newCardIssuer.trim() || 'Cartão',
      last4: newCardLast4.replace(/\D/g, '').slice(-4).padStart(4, '0'),
      limitCents,
      closingDay: Math.max(1, Math.min(28, newCardClosing)),
      dueDay: Math.max(1, Math.min(31, newCardDue)),
      defaultAccountId: state.accounts[0]?.id ?? '',
      accentColor: '#1E293B',
    };
    setState((prev) => ({ ...prev, cards: [...prev.cards, card] }));
    setNewCardName('');
    setNewCardIssuer('');
    setNewCardLast4('');
    setNewCardLimit('');
    showToast(`Cartão "${card.name}" adicionado.`);
  }

  function handleAddRecurrence(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRLToCents(newRecAmount);
    if (!newRecTitle.trim() || cents <= 0) return;
    const rule: RecurrenceRule = {
      id: `rec-${Date.now()}`,
      title: newRecTitle.trim(),
      category: newRecCategory,
      amountCents: cents,
      type: newRecType,
      frequency: newRecFreq,
      interval: 1,
      dayOfMonth: Math.max(1, Math.min(31, newRecDay)),
      startDate: `${currentYm}-01`,
      accountId: state.accounts[0]?.id,
      important: newRecImportant,
      autoCalendarAlert: newRecImportant,
      active: true,
    };
    setState((prev) => ({ ...prev, recurrences: [rule, ...prev.recurrences] }));
    setNewRecTitle('');
    setNewRecAmount('');
    showToast(`Regra recorrente "${rule.title}" cadastrada.`);
  }

  function handleRunRecurrenceEngine(targetYm: string) {
    const cardsMap = new Map(state.cards.map((c) => [c.id, c]));
    const generated = generateRecurringTransactionsForPeriod(
      state.recurrences,
      state.transactions,
      targetYm,
      cardsMap,
    );
    if (generated.length === 0) {
      showToast(`Motor idempotente: todas as recorrências de ${targetYm} já foram geradas (0 duplicatas).`);
      return;
    }
    setState((prev) => ({
      ...prev,
      transactions: [...generated, ...prev.transactions],
    }));
    showToast(`${generated.length} lançamento(s) recorrente(s) gerado(s) para ${targetYm}.`);
  }

  function handlePayCardStatement(card: CreditCard, period: string) {
    const statementTxs = state.transactions.filter(
      (tx) => tx.creditCardId === card.id && tx.statementPeriod === period && tx.status === 'pending',
    );
    if (statementTxs.length === 0) {
      showToast('Esta fatura não possui itens pendentes.');
      return;
    }
    const total = sumCents(statementTxs.map((t) => t.amountCents));
    const paymentTx: Transaction = {
      id: `pay-card-${card.id}-${period}-${Date.now()}`,
      description: `Pagamento Fatura ${card.name} (${period})`,
      category: 'Fatura Cartão',
      amountCents: total,
      type: 'expense',
      competenceDate: getCardStatementDueDate(period, card.dueDay),
      status: 'paid',
      accountId: card.defaultAccountId || state.accounts[0]?.id,
      createdAtUtc: new Date().toISOString(),
    };

    setState((prev) => ({
      ...prev,
      transactions: [
        paymentTx,
        ...prev.transactions.map((tx) =>
          tx.creditCardId === card.id && tx.statementPeriod === period ? { ...tx, status: 'paid' as const } : tx,
        ),
      ],
    }));
    showToast(`Fatura ${period} de ${card.name} (${formatCentsBRL(total)}) liquidada!`);
  }

  function handleResetDemo() {
    const fresh = buildInitialSeedState();
    setState(fresh);
    showToast('Dados de demonstração restaurados.');
  }

  const pageMeta: Record<NavTab, { title: string; subtitle: string }> = {
    overview: {
      title: 'Visão Geral',
      subtitle: `Competência ${currentYm} • Precisão contábil em centavos inteiros`,
    },
    accounts: {
      title: 'Contas Bancárias & Reservas',
      subtitle: 'Saldos calculados dinamicamente sobre lançamentos liquidados',
    },
    cards: {
      title: 'Cartões de Crédito & Faturas',
      subtitle: 'Fechamento separado do vencimento com parcelamento explícito por fatura',
    },
    transactions: {
      title: 'Entradas & Saídas',
      subtitle: 'Extrato unificado de receitas, despesas, faturas e transferências',
    },
    recurrences: {
      title: 'Dívidas & Contas Recorrentes',
      subtitle: 'Motor idempotente com proteção contra duplicidade e alerta no Google Calendar',
    },
    calendar: {
      title: 'Integração Google Calendar',
      subtitle: 'Alertas financeiros em calendário secundário isolado da sua agenda pessoal',
    },
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <div className="brand-mark">SF</div>
          <div>
            <div className="brand-title">SuperFinance</div>
            <div className="brand-sub">Ledger em Centavos</div>
          </div>
        </div>

        <nav className="nav-list">
          <button
            type="button"
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <LayoutDashboard size={17} />
            Visão Geral
          </button>
          <button
            type="button"
            className={`nav-item ${activeTab === 'accounts' ? 'active' : ''}`}
            onClick={() => setActiveTab('accounts')}
          >
            <Landmark size={17} />
            Contas
          </button>
          <button
            type="button"
            className={`nav-item ${activeTab === 'cards' ? 'active' : ''}`}
            onClick={() => setActiveTab('cards')}
          >
            <CreditCardIcon size={17} />
            Cartões & Faturas
          </button>
          <button
            type="button"
            className={`nav-item ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
          >
            <ArrowUpRight size={17} />
            Lançamentos
          </button>
          <button
            type="button"
            className={`nav-item ${activeTab === 'recurrences' ? 'active' : ''}`}
            onClick={() => setActiveTab('recurrences')}
          >
            <Repeat size={17} />
            Recorrentes
          </button>
          <button
            type="button"
            className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`}
            onClick={() => setActiveTab('calendar')}
          >
            <CalendarClock size={17} />
            Google Calendar
            {importantPendingTxs.length > 0 && (
              <span className="nav-badge">{importantPendingTxs.length}</span>
            )}
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-row">
            <span className={`status-dot ${calStatus?.connected ? 'online' : ''}`} />
            {calStatus?.connected ? 'Calendar Conectado' : 'Calendar Offline'}
          </div>
          <span>
            {calStatus?.connected
              ? 'Calendário de teste isolado da agenda pessoal.'
              : 'Use .ics ou servidor local.'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ justifyContent: 'flex-start', paddingLeft: 0, marginTop: 2 }}
            onClick={handleResetDemo}
          >
            <RotateCcw size={13} />
            Restaurar dados demo
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <h1 className="page-title">{pageMeta[activeTab].title}</h1>
            <p className="page-subtitle">{pageMeta[activeTab].subtitle}</p>
          </div>
          <div className="topbar-actions">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setCurrentYm((ym) => shiftYearMonth(ym, -1))}
                aria-label="Mês anterior"
              >
                ←
              </button>
              <span className="mono" style={{ fontWeight: 600, fontSize: 13.5, padding: '0 6px' }}>
                {currentYm}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setCurrentYm((ym) => shiftYearMonth(ym, 1))}
                aria-label="Próximo mês"
              >
                →
              </button>
            </div>
            <button
              type="button"
              id="btn-new-transaction"
              className="btn btn-primary"
              onClick={() => setShowNewTxModal(true)}
            >
              <Plus size={16} />
              Novo Lançamento
            </button>
          </div>
        </header>

        {/* TAB: VISÃO GERAL */}
        {activeTab === 'overview' && (
          <>
            <section className="kpi-grid" aria-label="Indicadores financeiros">
              <div className="surface">
                <div className="kpi-label">
                  <span>Patrimônio Líquido</span>
                  <Landmark size={16} />
                </div>
                <div className="kpi-value mono">{formatCentsBRL(netWorthCents)}</div>
                <div className="kpi-meta">Contas menos faturas em aberto</div>
              </div>

              <div className="surface">
                <div className="kpi-label">
                  <span>Entradas ({currentYm})</span>
                  <ArrowDownLeft size={16} className="text-emerald" />
                </div>
                <div className="kpi-value mono text-emerald">{formatCentsBRL(monthIncomeCents)}</div>
                <div className="kpi-meta">Receitas lançadas no mês</div>
              </div>

              <div className="surface">
                <div className="kpi-label">
                  <span>Saídas ({currentYm})</span>
                  <ArrowUpRight size={16} className="text-terracotta" />
                </div>
                <div className="kpi-value mono text-terracotta">{formatCentsBRL(monthExpenseCents)}</div>
                <div className="kpi-meta">
                  Resultado:{' '}
                  <strong className={`mono ${monthResultCents >= 0 ? 'text-emerald' : 'text-terracotta'}`}>
                    {formatCentsBRL(monthResultCents, { showSign: true })}
                  </strong>
                </div>
              </div>

              <div className="surface">
                <div className="kpi-label">
                  <span>Limite Comprometido</span>
                  <CreditCardIcon size={16} className="text-navy" />
                </div>
                <div className="kpi-value mono text-navy">{formatCentsBRL(totalOpenCardsCents)}</div>
                <div className="kpi-meta">Total em aberto em {state.cards.length} cartão(ões)</div>
              </div>
            </section>

            <section className="grid-2">
              <CashflowChart transactions={state.transactions} currentYearMonth={currentYm} />

              <div className="surface">
                <div className="section-header">
                  <div>
                    <h2 className="section-title">Próximos Vencimentos</h2>
                    <p className="section-desc">Contas importantes com alerta rápido no Google Calendar</p>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => setActiveTab('calendar')}>
                    Ver Agenda
                  </button>
                </div>

                {importantPendingTxs.length === 0 ? (
                  <p className="section-desc">Tudo em dia! Nenhuma conta pendente.</p>
                ) : (
                  <div className="list-stack">
                    {importantPendingTxs.slice(0, 5).map((tx) => (
                      <div key={tx.id} className="list-row">
                        <div className="list-row-main">
                          <div className="list-row-title">{tx.description}</div>
                          <div className="list-row-sub">
                            <span className="mono">{tx.competenceDate}</span>
                            <span>•</span>
                            <span>{tx.category}</span>
                          </div>
                        </div>
                        <div className="list-row-right">
                          <span className="mono text-terracotta" style={{ fontWeight: 600 }}>
                            {formatCentsBRL(tx.amountCents)}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm"
                            title="Criar alerta no Google Calendar"
                            disabled={creatingAlert || !calStatus?.connected}
                            onClick={() =>
                              void handleCreateCalendarAlert(
                                {
                                  summary: `[SuperFinance] Pagar ${tx.description} (${formatCentsBRL(tx.amountCents)})`,
                                  date: tx.competenceDate,
                                  description: `Categoria: ${tx.category}\nValor: ${formatCentsBRL(tx.amountCents)}`,
                                  allDay: true,
                                  colorId: '11',
                                },
                                tx.id,
                              )
                            }
                          >
                            <Bell size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="surface">
              <div className="section-header">
                <div>
                  <h2 className="section-title">Despesas por Categoria ({currentYm})</h2>
                  <p className="section-desc">Distribuição proporcional dos gastos do período selecionado</p>
                </div>
              </div>
              {categoryBreakdown.length === 0 ? (
                <p className="section-desc">Nenhuma despesa registrada neste mês.</p>
              ) : (
                <div className="grid-3">
                  {categoryBreakdown.map((item) => {
                    const pct = monthExpenseCents > 0 ? Math.round((item.cents / monthExpenseCents) * 100) : 0;
                    return (
                      <div key={item.category} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                          <span style={{ fontWeight: 600 }}>{item.category}</span>
                          <span className="mono" style={{ fontWeight: 600 }}>
                            {formatCentsBRL(item.cents)} <span style={{ color: 'var(--ink-muted)' }}>({pct}%)</span>
                          </span>
                        </div>
                        <div className="progress-track-light">
                          <div className="progress-fill-dark" style={{ width: `${Math.max(4, pct)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {/* TAB: CONTAS */}
        {activeTab === 'accounts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="grid-3">
              {state.accounts.map((acc) => {
                const bal = accountBalances.get(acc.id) ?? acc.initialBalanceCents;
                return (
                  <div key={acc.id} className="surface">
                    <div className="kpi-label">
                      <span>{acc.institution}</span>
                      <span className="tag">{ACCOUNT_TYPE_LABELS[acc.type]}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{acc.name}</div>
                    <div className={`kpi-value mono ${bal >= 0 ? 'text-emerald' : 'text-terracotta'}`}>
                      {formatCentsBRL(bal)}
                    </div>
                    <div className="kpi-meta">
                      Saldo inicial: <span className="mono">{formatCentsBRL(acc.initialBalanceCents)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="surface">
              <h2 className="section-title" style={{ marginBottom: 14 }}>
                Adicionar Nova Conta
              </h2>
              <form onSubmit={handleAddAccount} className="form-grid">
                <div className="field">
                  <label htmlFor="acc-name">Nome da Conta</label>
                  <input
                    id="acc-name"
                    className="input"
                    placeholder="Ex.: Conta PJ, Caixinha Viagem..."
                    value={newAccName}
                    onChange={(e) => setNewAccName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="acc-inst">Instituição</label>
                  <input
                    id="acc-inst"
                    className="input"
                    placeholder="Ex.: Nubank, Itaú, XP..."
                    value={newAccInst}
                    onChange={(e) => setNewAccInst(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="acc-type">Tipo</label>
                  <select
                    id="acc-type"
                    className="select"
                    value={newAccType}
                    onChange={(e) => setNewAccType(e.target.value as AccountType)}
                  >
                    <option value="checking">Conta Corrente</option>
                    <option value="savings">Poupança / Reserva</option>
                    <option value="cash">Dinheiro</option>
                    <option value="investment">Investimentos</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="acc-bal">Saldo Inicial (R$)</label>
                  <input
                    id="acc-bal"
                    className="input mono"
                    placeholder="0,00"
                    value={newAccBalance}
                    onChange={(e) => setNewAccBalance(e.target.value)}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary">
                    <Plus size={15} /> Cadastrar Conta
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB: CARTÕES & FATURAS */}
        {activeTab === 'cards' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div className="grid-equal">
              {state.cards.map((card) => {
                const usedCents = computeCardUsedLimitCents(card.id, state.transactions);
                const availCents = Math.max(0, subtractCents(card.limitCents, usedCents));
                const usagePct = card.limitCents > 0 ? Math.min(100, Math.round((usedCents / card.limitCents) * 100)) : 0;
                const stmtPeriod = shiftYearMonth(currentYm, card.dueDay < card.closingDay ? 1 : 0);
                const stmtCents = computeCardStatementCents(card.id, stmtPeriod, state.transactions);
                const stmtDueDate = getCardStatementDueDate(stmtPeriod, card.dueDay);
                const stmtTxs = state.transactions.filter(
                  (tx) => tx.creditCardId === card.id && tx.statementPeriod === stmtPeriod,
                );

                return (
                  <div key={card.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="credit-card-tile" style={{ background: card.accentColor }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.78 }}>{card.issuer}</div>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>{card.name}</div>
                        </div>
                        <span className="mono" style={{ fontSize: 13, opacity: 0.9 }}>
                          •••• {card.last4}
                        </span>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                          <span>Limite utilizado ({usagePct}%)</span>
                          <span className="mono">Disponível: {formatCentsBRL(availCents)}</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${usagePct}%` }} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, opacity: 0.9 }}>
                        <span>Fechamento: dia {card.closingDay}</span>
                        <span>Vencimento: dia {card.dueDay}</span>
                        <span className="mono">Limite: {formatCentsBRL(card.limitCents)}</span>
                      </div>
                    </div>

                    <div className="surface">
                      <div className="section-header">
                        <div>
                          <h3 className="section-title">Fatura {stmtPeriod}</h3>
                          <p className="section-desc">
                            Vencimento: <span className="mono">{stmtDueDate}</span>
                          </p>
                        </div>
                        <div className="mono" style={{ fontWeight: 700, fontSize: 18 }}>
                          {formatCentsBRL(stmtCents)}
                        </div>
                      </div>

                      {stmtTxs.length === 0 ? (
                        <p className="section-desc">Sem compras lançadas nesta fatura.</p>
                      ) : (
                        <div className="list-stack" style={{ marginBottom: 14 }}>
                          {stmtTxs.map((tx) => (
                            <div key={tx.id} className="list-row">
                              <div className="list-row-main">
                                <div className="list-row-title">{tx.description}</div>
                                <div className="list-row-sub">
                                  <span>{tx.category}</span>
                                  <span>•</span>
                                  <span className={`tag ${tx.status === 'paid' ? 'tag-emerald' : 'tag-amber'}`}>
                                    {tx.status === 'paid' ? 'Paga' : 'Aberta'}
                                  </span>
                                </div>
                              </div>
                              <span className="mono" style={{ fontWeight: 600 }}>
                                {formatCentsBRL(tx.amountCents)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-emerald"
                          disabled={stmtCents === 0}
                          onClick={() => handlePayCardStatement(card, stmtPeriod)}
                        >
                          <Check size={14} /> Marcar Fatura Paga
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-navy"
                          disabled={creatingAlert || !calStatus?.connected}
                          onClick={() =>
                            void handleCreateCalendarAlert({
                              summary: `[SuperFinance] Vencimento Fatura ${card.name} (${formatCentsBRL(stmtCents)})`,
                              date: stmtDueDate,
                              description: `Fatura ${stmtPeriod} • Cartão ${card.name} (•••• ${card.last4})\nValor atual: ${formatCentsBRL(stmtCents)}`,
                              allDay: true,
                              colorId: '9',
                            })
                          }
                        >
                          <Bell size={14} /> Alertar no Google Calendar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="surface">
              <h2 className="section-title" style={{ marginBottom: 14 }}>
                Adicionar Cartão de Crédito
              </h2>
              <form onSubmit={handleAddCard} className="form-grid">
                <div className="field">
                  <label htmlFor="c-name">Nome do Cartão</label>
                  <input
                    id="c-name"
                    className="input"
                    placeholder="Ex.: Itaú Personnalité Black"
                    value={newCardName}
                    onChange={(e) => setNewCardName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-issuer">Emissor</label>
                  <input
                    id="c-issuer"
                    className="input"
                    placeholder="Ex.: Itaú, XP, C6..."
                    value={newCardIssuer}
                    onChange={(e) => setNewCardIssuer(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-last4">Últimos 4 dígitos</label>
                  <input
                    id="c-last4"
                    className="input mono"
                    maxLength={4}
                    placeholder="1234"
                    value={newCardLast4}
                    onChange={(e) => setNewCardLast4(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-limit">Limite Total (R$)</label>
                  <input
                    id="c-limit"
                    className="input mono"
                    placeholder="10.000,00"
                    value={newCardLimit}
                    onChange={(e) => setNewCardLimit(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-closing">Dia de Fechamento (1–28)</label>
                  <input
                    id="c-closing"
                    type="number"
                    min={1}
                    max={28}
                    className="input mono"
                    value={newCardClosing}
                    onChange={(e) => setNewCardClosing(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-due">Dia de Vencimento (1–31)</label>
                  <input
                    id="c-due"
                    type="number"
                    min={1}
                    max={31}
                    className="input mono"
                    value={newCardDue}
                    onChange={(e) => setNewCardDue(Number(e.target.value))}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary">
                    <Plus size={15} /> Cadastrar Cartão
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB: LANÇAMENTOS */}
        {activeTab === 'transactions' && (
          <div className="surface">
            <div className="filters-bar">
              <input
                className="input"
                style={{ flex: 1, minWidth: 200 }}
                placeholder="Buscar por descrição ou categoria..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
              />
              <select
                className="select"
                value={txFilterType}
                onChange={(e) => setTxFilterType(e.target.value as 'all' | 'income' | 'expense' | 'transfer')}
              >
                <option value="all">Todos os tipos</option>
                <option value="income">Entradas</option>
                <option value="expense">Saídas</option>
                <option value="transfer">Transferências</option>
              </select>
              <select
                className="select"
                value={txFilterStatus}
                onChange={(e) => setTxFilterStatus(e.target.value as 'all' | 'paid' | 'pending')}
              >
                <option value="all">Todas situações</option>
                <option value="paid">Pagos</option>
                <option value="pending">Pendentes</option>
              </select>
            </div>

            {filteredTransactions.length === 0 ? (
              <p className="section-desc">Nenhum lançamento encontrado para os filtros aplicados.</p>
            ) : (
              <div className="list-stack">
                {filteredTransactions.map((tx) => {
                  const accountName = state.accounts.find((a) => a.id === tx.accountId)?.name;
                  const cardName = state.cards.find((c) => c.id === tx.creditCardId)?.name;
                  return (
                    <div key={tx.id} className="list-row">
                      <div className="list-row-main">
                        <div className="list-row-title">
                          {tx.description}
                          {tx.important && <span className="tag tag-amber">Importante</span>}
                          {tx.statementPeriod && <span className="tag tag-navy">Fatura {tx.statementPeriod}</span>}
                        </div>
                        <div className="list-row-sub">
                          <span className="mono">{tx.competenceDate}</span>
                          <span>•</span>
                          <span>{tx.category}</span>
                          <span>•</span>
                          <span>{cardName ? `Cartão ${cardName}` : accountName || 'Conta'}</span>
                        </div>
                      </div>
                      <div className="list-row-right">
                        <span
                          className={`mono ${
                            tx.type === 'income'
                              ? 'text-emerald'
                              : tx.type === 'expense'
                                ? 'text-terracotta'
                                : 'text-navy'
                          }`}
                          style={{ fontWeight: 700 }}
                        >
                          {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                          {formatCentsBRL(tx.amountCents)}
                        </span>
                        <button
                          type="button"
                          className={`btn btn-sm ${tx.status === 'paid' ? '' : 'btn-emerald'}`}
                          onClick={() => handleToggleTxStatus(tx.id)}
                        >
                          {tx.status === 'paid' ? 'Pago' : 'Marcar Pago'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label="Excluir lançamento"
                          onClick={() => handleDeleteTx(tx.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB: DÍVIDAS RECORRENTES */}
        {activeTab === 'recurrences' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="surface">
              <div className="section-header">
                <div>
                  <h2 className="section-title">Motor Idempotente de Recorrências</h2>
                  <p className="section-desc">
                    Gera lançamentos de {currentYm} ou do próximo mês sem risco de duplicação (chave única{' '}
                    <code className="mono">ruleId::YYYY-MM</code>)
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleRunRecurrenceEngine(currentYm)}
                  >
                    <Repeat size={14} /> Gerar {currentYm}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => handleRunRecurrenceEngine(shiftYearMonth(currentYm, 1))}
                  >
                    Projetar {shiftYearMonth(currentYm, 1)}
                  </button>
                </div>
              </div>

              <div className="list-stack">
                {state.recurrences.map((rule) => (
                  <div key={rule.id} className="list-row">
                    <div className="list-row-main">
                      <div className="list-row-title">
                        {rule.title}
                        <span className="tag">{FREQ_LABELS[rule.frequency]}</span>
                        {rule.important && <span className="tag tag-amber">Importante</span>}
                      </div>
                      <div className="list-row-sub">
                        <span>{rule.category}</span>
                        <span>•</span>
                        <span className="mono">Dia {rule.dayOfMonth} de cada período</span>
                      </div>
                    </div>
                    <div className="list-row-right">
                      <span
                        className={`mono ${rule.type === 'income' ? 'text-emerald' : 'text-terracotta'}`}
                        style={{ fontWeight: 700 }}
                      >
                        {formatCentsBRL(rule.amountCents)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-navy"
                        disabled={creatingAlert || !calStatus?.connected}
                        onClick={() =>
                          void handleCreateCalendarAlert({
                            summary: `[SuperFinance] ${rule.title} (${formatCentsBRL(rule.amountCents)})`,
                            date: `${currentYm}-${String(Math.min(28, rule.dayOfMonth)).padStart(2, '0')}`,
                            description: `Dívida/Conta recorrente (${FREQ_LABELS[rule.frequency]}) • Categoria: ${rule.category}`,
                            recurringFreq: rule.frequency.toUpperCase() as 'MONTHLY' | 'WEEKLY' | 'YEARLY',
                            allDay: false,
                            colorId: '11',
                          })
                        }
                      >
                        <Bell size={13} /> Série no Calendar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface">
              <h2 className="section-title" style={{ marginBottom: 14 }}>
                Nova Dívida / Conta Recorrente
              </h2>
              <form onSubmit={handleAddRecurrence} className="form-grid">
                <div className="field">
                  <label htmlFor="r-title">Descrição</label>
                  <input
                    id="r-title"
                    className="input"
                    placeholder="Ex.: Plano de Saúde, Financiamento, Academia..."
                    value={newRecTitle}
                    onChange={(e) => setNewRecTitle(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="r-amount">Valor (R$)</label>
                  <input
                    id="r-amount"
                    className="input mono"
                    placeholder="0,00"
                    value={newRecAmount}
                    onChange={(e) => setNewRecAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="r-type">Tipo</label>
                  <select
                    id="r-type"
                    className="select"
                    value={newRecType}
                    onChange={(e) => setNewRecType(e.target.value as 'expense' | 'income')}
                  >
                    <option value="expense">Dívida / Despesa Recorrente</option>
                    <option value="income">Receita Recorrente</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="r-freq">Frequência</label>
                  <select
                    id="r-freq"
                    className="select"
                    value={newRecFreq}
                    onChange={(e) => setNewRecFreq(e.target.value as RecurrenceFrequency)}
                  >
                    <option value="monthly">Mensal</option>
                    <option value="weekly">Semanal</option>
                    <option value="yearly">Anual</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="r-day">Dia de Vencimento (1–31)</label>
                  <input
                    id="r-day"
                    type="number"
                    min={1}
                    max={31}
                    className="input mono"
                    value={newRecDay}
                    onChange={(e) => setNewRecDay(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="r-cat">Categoria</label>
                  <input
                    id="r-cat"
                    className="input"
                    value={newRecCategory}
                    onChange={(e) => setNewRecCategory(e.target.value)}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={newRecImportant}
                      onChange={(e) => setNewRecImportant(e.target.checked)}
                    />
                    Conta importante (destaque para alertas no Google Calendar)
                  </label>
                  <button type="submit" className="btn btn-primary">
                    <Plus size={15} /> Cadastrar Recorrência
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB: GOOGLE CALENDAR */}
        {activeTab === 'calendar' && (
          <CalendarAlertsPanel
            status={calStatus}
            events={calEvents}
            transactions={state.transactions}
            loadingEvents={loadingCal}
            creatingAlert={creatingAlert}
            importantPendingTxs={importantPendingTxs}
            onRefresh={() => void refreshCalendar()}
            onCreateAlert={handleCreateCalendarAlert}
            onBatchSyncAlerts={handleBatchSyncAlerts}
          />
        )}
      </main>

      {showNewTxModal && (
        <NewTransactionModal
          accounts={state.accounts}
          cards={state.cards}
          onClose={() => setShowNewTxModal(false)}
          onSave={handleSaveNewTransactions}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.link && (
            <a href={toast.link} target="_blank" rel="noreferrer">
              Abrir evento
            </a>
          )}
        </div>
      )}
    </div>
  );
}
export default App;
