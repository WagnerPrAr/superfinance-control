import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CalendarClock,
  Check,
  CreditCard as CreditCardIcon,
  Filter,
  Landmark,
  LayoutDashboard,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
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
  buildGoogleCalendarWebUrl,
  createCalendarAlert,
  fetchCalendarEvents,
  fetchCalendarStatus,
  type CalendarStatusResponse,
  type CreateAlertPayload,
} from './services/calendarApi';
import { CashflowChart } from './components/CashflowChart';
import { CategoryChart } from './components/CategoryChart';
import { NewTransactionModal } from './components/NewTransactionModal';
import { CalendarAlertsPanel, type SelectedAlertRequest } from './components/CalendarAlertsPanel';
import { CollapsiblePanel } from './components/CollapsiblePanel';
import { AnimatedCurrency } from './components/AnimatedCurrency';
import { SwipeableTransactionRow } from './components/SwipeableTransactionRow';
import { InfoBalloon } from './components/InfoBalloon';
import { usePersistedState } from './hooks/usePersistedState';
import { registerAndroidBackHandler, syncAndroidThemeColor } from './utils/androidBridge';

type NavTab = 'overview' | 'accounts' | 'cards' | 'transactions' | 'recurrences' | 'calendar';

const TAB_ORDER: readonly NavTab[] = [
  'overview',
  'accounts',
  'cards',
  'transactions',
  'recurrences',
  'calendar',
];

interface OverviewPrefs {
  showSecondaryKpis: boolean;
  showCashflow: boolean;
  showUpcoming: boolean;
  showCategories: boolean;
}

const STORAGE_KEY = 'superfinance_state_v1';
const VIEW_PREFS_KEY = 'superfinance_view_prefs_v1';

const DEFAULT_OVERVIEW_PREFS: OverviewPrefs = {
  showSecondaryKpis: true,
  showCashflow: true,
  showUpcoming: true,
  showCategories: false,
};

function loadOverviewPrefs(): OverviewPrefs {
  try {
    const raw = localStorage.getItem(VIEW_PREFS_KEY);
    if (raw) {
      return { ...DEFAULT_OVERVIEW_PREFS, ...(JSON.parse(raw) as Partial<OverviewPrefs>) };
    }
  } catch {
    // Fallback
  }
  return DEFAULT_OVERVIEW_PREFS;
}

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
  const [activeTab, setActiveTab] = usePersistedState<NavTab>('sf_active_tab_v1', 'overview');
  const [currentYm, setCurrentYm] = usePersistedState<string>('sf_current_ym_v1', getCurrentYearMonth());
  const [showNewTxModal, setShowNewTxModal] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [justPaidId, setJustPaidId] = useState<string | null>(null);

  // Preferências de exibição escolhidas pelo usuário (persistidas entre telas e reloads)
  const [overviewPrefs, setOverviewPrefs] = useState<OverviewPrefs>(loadOverviewPrefs);
  const [showCustomizer, setShowCustomizer] = usePersistedState<boolean>('sf_show_customizer_v1', false);
  const [showTxFilters, setShowTxFilters] = usePersistedState<boolean>('sf_show_tx_filters_v1', false);

  // Filtros de Lançamentos persistidos
  const [txFilterType, setTxFilterType] = usePersistedState<'all' | 'income' | 'expense' | 'transfer'>(
    'sf_tx_filter_type_v1',
    'all',
  );
  const [txFilterStatus, setTxFilterStatus] = usePersistedState<'all' | 'paid' | 'pending'>(
    'sf_tx_filter_status_v1',
    'all',
  );
  const [txSearch, setTxSearch] = usePersistedState<string>('sf_tx_search_v1', '');

  // Formulário de Conta (criar / editar) com rascunho persistido
  const [editingAccountId, setEditingAccountId] = usePersistedState<string | null>('sf_edit_acc_id_v1', null);
  const [accFormOpen, setAccFormOpen] = usePersistedState<boolean>('sf_acc_form_open_v1', false);
  const [newAccName, setNewAccName] = usePersistedState<string>('sf_acc_draft_name_v1', '');
  const [newAccInst, setNewAccInst] = usePersistedState<string>('sf_acc_draft_inst_v1', '');
  const [newAccType, setNewAccType] = usePersistedState<AccountType>('sf_acc_draft_type_v1', 'checking');
  const [newAccBalance, setNewAccBalance] = usePersistedState<string>('sf_acc_draft_bal_v1', '');

  // Formulário de Cartão (criar / editar) com rascunho persistido
  const [editingCardId, setEditingCardId] = usePersistedState<string | null>('sf_edit_card_id_v1', null);
  const [cardFormOpen, setCardFormOpen] = usePersistedState<boolean>('sf_card_form_open_v1', false);
  const [newCardName, setNewCardName] = usePersistedState<string>('sf_card_draft_name_v1', '');
  const [newCardIssuer, setNewCardIssuer] = usePersistedState<string>('sf_card_draft_issuer_v1', '');
  const [newCardLast4, setNewCardLast4] = usePersistedState<string>('sf_card_draft_last4_v1', '');
  const [newCardLimit, setNewCardLimit] = usePersistedState<string>('sf_card_draft_limit_v1', '');
  const [newCardClosing, setNewCardClosing] = usePersistedState<number>('sf_card_draft_closing_v1', 20);
  const [newCardDue, setNewCardDue] = usePersistedState<number>('sf_card_draft_due_v1', 28);

  // Formulário de Recorrência (criar / editar) com rascunho persistido
  const [editingRecId, setEditingRecId] = usePersistedState<string | null>('sf_edit_rec_id_v1', null);
  const [recFormOpen, setRecFormOpen] = usePersistedState<boolean>('sf_rec_form_open_v1', false);
  const [newRecTitle, setNewRecTitle] = usePersistedState<string>('sf_rec_draft_title_v1', '');
  const [newRecCategory, setNewRecCategory] = usePersistedState<string>('sf_rec_draft_cat_v1', 'Contas Fixas');
  const [newRecAmount, setNewRecAmount] = usePersistedState<string>('sf_rec_draft_amount_v1', '');
  const [newRecType, setNewRecType] = usePersistedState<'expense' | 'income'>('sf_rec_draft_type_v1', 'expense');
  const [newRecFreq, setNewRecFreq] = usePersistedState<RecurrenceFrequency>('sf_rec_draft_freq_v1', 'monthly');
  const [newRecDay, setNewRecDay] = usePersistedState<number>('sf_rec_draft_day_v1', 10);
  const [newRecImportant, setNewRecImportant] = usePersistedState<boolean>('sf_rec_draft_imp_v1', true);

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

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(overviewPrefs));
    } catch {
      // Ignora quota errors
    }
  }, [overviewPrefs]);

  useEffect(() => {
    return registerAndroidBackHandler(() => {
      if (showNewTxModal) {
        setShowNewTxModal(false);
        setEditingTx(null);
        return true;
      }
      if (activeTab !== 'overview') {
        setActiveTab('overview');
        return true;
      }
      return false;
    });
  }, [showNewTxModal, activeTab, setActiveTab]);

  function toggleOverviewPref(key: keyof OverviewPrefs) {
    setOverviewPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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

  function centsToEditableStr(cents: number): string {
    const abs = Math.abs(cents);
    const reais = Math.trunc(abs / 100);
    const centavos = String(abs % 100).padStart(2, '0');
    return `${cents < 0 ? '-' : ''}${reais},${centavos}`;
  }

  function handleSaveNewTransactions(newTxs: Transaction[], scheduleAlert: boolean, isEdit?: boolean) {
    if (isEdit && newTxs[0]) {
      const updated = newTxs[0];
      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.map((tx) => (tx.id === updated.id ? updated : tx)),
      }));
      setEditingTx(null);
      setShowNewTxModal(false);
      showToast('Lançamento atualizado com sucesso.');
      return;
    }

    setState((prev) => ({
      ...prev,
      transactions: [...newTxs, ...prev.transactions],
    }));
    setShowNewTxModal(false);
    showToast(
      newTxs.length > 1
        ? `${newTxs.length} parcelas registradas com sucesso.`
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

  function handleStartEditTx(tx: Transaction) {
    setEditingTx(tx);
    setShowNewTxModal(true);
  }

  function handleToggleTxStatus(id: string) {
    const target = state.transactions.find((t) => t.id === id);
    const becomingPaid = target?.status !== 'paid';
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.map((tx) =>
        tx.id === id ? { ...tx, status: tx.status === 'paid' ? 'pending' : 'paid' } : tx,
      ),
    }));
    if (becomingPaid) {
      setJustPaidId(id);
      setTimeout(() => {
        setJustPaidId((curr) => (curr === id ? null : curr));
      }, 850);
    }
  }

  function handleDeleteTx(id: string, description: string) {
    if (!window.confirm(`Deseja excluir o lançamento "${description}"?`)) return;
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((tx) => tx.id !== id),
    }));
    showToast('Lançamento excluído.');
  }

  function resetAccountForm() {
    setEditingAccountId(null);
    setNewAccName('');
    setNewAccInst('');
    setNewAccType('checking');
    setNewAccBalance('');
  }

  function handleStartEditAccount(acc: Account) {
    setEditingAccountId(acc.id);
    setNewAccName(acc.name);
    setNewAccInst(acc.institution);
    setNewAccType(acc.type);
    setNewAccBalance(centsToEditableStr(acc.initialBalanceCents));
    setAccFormOpen(true);
  }

  function handleDeleteAccount(acc: Account) {
    if (!window.confirm(`Deseja excluir a conta "${acc.name}"?`)) return;
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.filter((a) => a.id !== acc.id),
    }));
    if (editingAccountId === acc.id) resetAccountForm();
    showToast(`Conta "${acc.name}" excluída.`);
  }

  function handleAddAccount(e: FormEvent) {
    e.preventDefault();
    if (!newAccName.trim()) return;
    const balanceCents = parseBRLToCents(newAccBalance);

    if (editingAccountId) {
      setState((prev) => ({
        ...prev,
        accounts: prev.accounts.map((a) =>
          a.id === editingAccountId
            ? {
                ...a,
                name: newAccName.trim(),
                institution: newAccInst.trim() || 'Banco',
                type: newAccType,
                initialBalanceCents: balanceCents,
              }
            : a,
        ),
      }));
      showToast(`Conta "${newAccName.trim()}" atualizada.`);
      resetAccountForm();
      setAccFormOpen(false);
      return;
    }

    const acc: Account = {
      id: `acc-${Date.now()}`,
      name: newAccName.trim(),
      institution: newAccInst.trim() || 'Banco',
      type: newAccType,
      initialBalanceCents: balanceCents,
      accentColor: '#0F6E56',
    };
    setState((prev) => ({ ...prev, accounts: [...prev.accounts, acc] }));
    resetAccountForm();
    setAccFormOpen(false);
    showToast(`Conta "${acc.name}" adicionada.`);
  }

  function resetCardForm() {
    setEditingCardId(null);
    setNewCardName('');
    setNewCardIssuer('');
    setNewCardLast4('');
    setNewCardLimit('');
    setNewCardClosing(20);
    setNewCardDue(28);
  }

  function handleStartEditCard(card: CreditCard) {
    setEditingCardId(card.id);
    setNewCardName(card.name);
    setNewCardIssuer(card.issuer);
    setNewCardLast4(card.last4);
    setNewCardLimit(centsToEditableStr(card.limitCents));
    setNewCardClosing(card.closingDay);
    setNewCardDue(card.dueDay);
    setCardFormOpen(true);
  }

  function handleDeleteCard(card: CreditCard) {
    if (!window.confirm(`Deseja excluir o cartão "${card.name}"?`)) return;
    setState((prev) => ({
      ...prev,
      cards: prev.cards.filter((c) => c.id !== card.id),
    }));
    if (editingCardId === card.id) resetCardForm();
    showToast(`Cartão "${card.name}" excluído.`);
  }

  function handleAddCard(e: FormEvent) {
    e.preventDefault();
    const limitCents = parseBRLToCents(newCardLimit);
    if (!newCardName.trim() || limitCents <= 0) return;
    const last4 = newCardLast4.replace(/\D/g, '').slice(-4).padStart(4, '0');
    const closingDay = Math.max(1, Math.min(28, newCardClosing));
    const dueDay = Math.max(1, Math.min(31, newCardDue));

    if (editingCardId) {
      setState((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === editingCardId
            ? {
                ...c,
                name: newCardName.trim(),
                issuer: newCardIssuer.trim() || 'Cartão',
                last4,
                limitCents,
                closingDay,
                dueDay,
              }
            : c,
        ),
      }));
      showToast(`Cartão "${newCardName.trim()}" atualizado.`);
      resetCardForm();
      setCardFormOpen(false);
      return;
    }

    const card: CreditCard = {
      id: `card-${Date.now()}`,
      name: newCardName.trim(),
      issuer: newCardIssuer.trim() || 'Cartão',
      last4,
      limitCents,
      closingDay,
      dueDay,
      defaultAccountId: state.accounts[0]?.id ?? '',
      accentColor: '#1E293B',
    };
    setState((prev) => ({ ...prev, cards: [...prev.cards, card] }));
    resetCardForm();
    setCardFormOpen(false);
    showToast(`Cartão "${card.name}" adicionado.`);
  }

  function resetRecForm() {
    setEditingRecId(null);
    setNewRecTitle('');
    setNewRecCategory('Contas Fixas');
    setNewRecAmount('');
    setNewRecType('expense');
    setNewRecFreq('monthly');
    setNewRecDay(10);
    setNewRecImportant(true);
  }

  function handleStartEditRecurrence(rule: RecurrenceRule) {
    setEditingRecId(rule.id);
    setNewRecTitle(rule.title);
    setNewRecCategory(rule.category);
    setNewRecAmount(centsToEditableStr(rule.amountCents));
    setNewRecType(rule.type);
    setNewRecFreq(rule.frequency);
    setNewRecDay(rule.dayOfMonth);
    setNewRecImportant(rule.important);
    setRecFormOpen(true);
  }

  function handleDeleteRecurrence(rule: RecurrenceRule) {
    if (!window.confirm(`Deseja excluir a conta fixa "${rule.title}"?`)) return;
    setState((prev) => ({
      ...prev,
      recurrences: prev.recurrences.filter((r) => r.id !== rule.id),
    }));
    if (editingRecId === rule.id) resetRecForm();
    showToast(`Conta fixa "${rule.title}" excluída.`);
  }

  function handleAddRecurrence(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRLToCents(newRecAmount);
    if (!newRecTitle.trim() || cents <= 0) return;
    const dayOfMonth = Math.max(1, Math.min(31, newRecDay));

    if (editingRecId) {
      setState((prev) => ({
        ...prev,
        recurrences: prev.recurrences.map((r) =>
          r.id === editingRecId
            ? {
                ...r,
                title: newRecTitle.trim(),
                category: newRecCategory,
                amountCents: cents,
                type: newRecType,
                frequency: newRecFreq,
                dayOfMonth,
                important: newRecImportant,
                autoCalendarAlert: newRecImportant,
              }
            : r,
        ),
      }));
      showToast(`Conta fixa "${newRecTitle.trim()}" atualizada.`);
      resetRecForm();
      setRecFormOpen(false);
      return;
    }

    const rule: RecurrenceRule = {
      id: `rec-${Date.now()}`,
      title: newRecTitle.trim(),
      category: newRecCategory,
      amountCents: cents,
      type: newRecType,
      frequency: newRecFreq,
      interval: 1,
      dayOfMonth,
      startDate: `${currentYm}-01`,
      accountId: state.accounts[0]?.id,
      important: newRecImportant,
      autoCalendarAlert: newRecImportant,
      active: true,
    };
    setState((prev) => ({ ...prev, recurrences: [rule, ...prev.recurrences] }));
    resetRecForm();
    setRecFormOpen(false);
    showToast(`Conta fixa "${rule.title}" cadastrada.`);
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
      showToast(`Todas as contas fixas de ${targetYm} já estão lançadas (nenhuma duplicada).`);
      return;
    }
    setState((prev) => ({
      ...prev,
      transactions: [...generated, ...prev.transactions],
    }));
    showToast(`${generated.length} conta(s) fixa(s) lançada(s) para ${targetYm}.`);
  }

  function handlePayCardStatement(card: CreditCard, period: string) {
    const statementTxs = state.transactions.filter(
      (tx) => tx.creditCardId === card.id && tx.statementPeriod === period && tx.status === 'pending',
    );
    if (statementTxs.length === 0) {
      showToast('Esta fatura já está paga ou não tem compras.');
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
    showToast(`Fatura ${period} de ${card.name} (${formatCentsBRL(total)}) marcada como paga!`);
  }

  function handleResetDemo() {
    if (!window.confirm('Restaurar os dados iniciais de demonstração?')) return;
    const fresh = buildInitialSeedState();
    setState(fresh);
    showToast('Dados de demonstração restaurados.');
  }

  const pageMeta: Record<NavTab, { title: string; subtitle: string }> = {
    overview: {
      title: 'Visão Geral',
      subtitle: `Resumo financeiro de ${currentYm}`,
    },
    accounts: {
      title: 'Contas & Reservas',
      subtitle: 'Acompanhe seus saldos atualizados em cada conta',
    },
    cards: {
      title: 'Cartões & Faturas',
      subtitle: 'Controle limites, datas de fechamento e faturas mensais',
    },
    transactions: {
      title: 'Lançamentos',
      subtitle: 'Todas as suas receitas, despesas e transferências',
    },
    recurrences: {
      title: 'Contas Fixas',
      subtitle: 'Gerencie dívidas recorrentes, assinaturas e receitas mensais',
    },
    calendar: {
      title: 'Alertas no Google Calendar',
      subtitle: 'Crie lembretes de pagamento em uma agenda separada da sua pessoal',
    },
  };

  const monthMood: 'good' | 'bad' | 'neutral' =
    monthResultCents > 0 ? 'good' : monthResultCents < 0 ? 'bad' : 'neutral';
  const activeTabIdx = Math.max(0, TAB_ORDER.indexOf(activeTab));

  useEffect(() => {
    syncAndroidThemeColor(monthMood);
  }, [monthMood]);

  return (
    <div className="app-shell" data-month-mood={monthMood}>
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <div className="brand-mark">SF</div>
          <div>
            <div className="brand-title">SuperFinance</div>
            <div className="brand-sub">Controle Financeiro</div>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 className="page-title">{pageMeta[activeTab].title}</h1>
              {monthMood !== 'neutral' && (
                <span className={`tag ${monthMood === 'good' ? 'tag-emerald' : 'tag-terracotta'}`}>
                  {monthMood === 'good' ? 'Mês positivo' : 'Mês no vermelho'}
                </span>
              )}
            </div>
            <p className="page-subtitle">{pageMeta[activeTab].subtitle}</p>
          </div>
          <div className="topbar-actions">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-icon-only"
                onClick={() => setCurrentYm((ym) => shiftYearMonth(ym, -1))}
                aria-label="Mês anterior"
              >
                ←
              </button>
              <span className="num-slide-wrap" style={{ padding: '0 4px' }}>
                <span key={currentYm} className="mono num-slide-inner num-slide-up" style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {currentYm}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-icon-only"
                onClick={() => setCurrentYm((ym) => shiftYearMonth(ym, 1))}
                aria-label="Próximo mês"
              >
                →
              </button>
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {activeTab === 'overview' && (
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-expanded={showCustomizer}
                  onClick={() => setShowCustomizer((v) => !v)}
                >
                  <SlidersHorizontal size={15} />
                  Personalizar
                </button>
              )}
              <button
                type="button"
                id="btn-new-transaction"
                className="btn btn-primary"
                onClick={() => setShowNewTxModal(true)}
              >
                <Plus size={16} />
                Novo
              </button>
            </div>
          </div>
        </header>

        <div key={activeTab} className="anim-tab-enter">
        {/* TAB: VISÃO GERAL */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {showCustomizer && (
              <div className="customizer-bar" role="region" aria-label="Personalizar painéis da visão geral">
                <button
                  type="button"
                  className={`chip-toggle ${overviewPrefs.showSecondaryKpis ? 'active' : ''}`}
                  onClick={() => toggleOverviewPref('showSecondaryKpis')}
                >
                  Indicadores do Mês
                </button>
                <button
                  type="button"
                  className={`chip-toggle ${overviewPrefs.showCashflow ? 'active' : ''}`}
                  onClick={() => toggleOverviewPref('showCashflow')}
                >
                  Fluxo de Caixa
                </button>
                <button
                  type="button"
                  className={`chip-toggle ${overviewPrefs.showUpcoming ? 'active' : ''}`}
                  onClick={() => toggleOverviewPref('showUpcoming')}
                >
                  Próximos Vencimentos
                </button>
                <button
                  type="button"
                  className={`chip-toggle ${overviewPrefs.showCategories ? 'active' : ''}`}
                  onClick={() => toggleOverviewPref('showCategories')}
                >
                  Gastos por Categoria
                </button>
              </div>
            )}

            <section
              className="kpi-grid"
              aria-label="Indicadores financeiros"
              style={overviewPrefs.showSecondaryKpis ? { marginBottom: 4 } : { gridTemplateColumns: '1fr', marginBottom: 4 }}
            >
              <div
                className={`surface ${
                  monthMood === 'good'
                    ? 'surface-mood-good'
                    : monthMood === 'bad'
                      ? 'surface-mood-bad'
                      : ''
                }`}
              >
                <div className="kpi-label">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Patrimônio Líquido
                    <InfoBalloon
                      title="Patrimônio Líquido"
                      text="Soma o saldo atual de todas as suas contas e subtrai o valor total das faturas de cartão que ainda estão em aberto."
                      align="left"
                    />
                  </span>
                  <Landmark size={16} />
                </div>
                <div className={`kpi-value mono ${netWorthCents < 0 ? 'text-terracotta' : ''}`}>
                  <AnimatedCurrency cents={netWorthCents} mode="count" />
                </div>
                <div className="kpi-meta">Saldo total menos faturas abertas</div>
              </div>

              {overviewPrefs.showSecondaryKpis && (
                <>
                  <div className="surface">
                    <div className="kpi-label">
                      <span>Entradas ({currentYm})</span>
                      <ArrowDownLeft size={16} className="text-emerald" />
                    </div>
                    <div className="kpi-value mono text-emerald">
                      <AnimatedCurrency cents={monthIncomeCents} mode="count" />
                    </div>
                    <div className="kpi-meta">Receitas do mês</div>
                  </div>

                  <div className="surface">
                    <div className="kpi-label">
                      <span>Saídas ({currentYm})</span>
                      <ArrowUpRight size={16} className="text-terracotta" />
                    </div>
                    <div className="kpi-value mono text-terracotta">
                      <AnimatedCurrency cents={monthExpenseCents} mode="count" />
                    </div>
                    <div className="kpi-meta">
                      Saldo do mês:{' '}
                      <strong className={`mono ${monthResultCents >= 0 ? 'text-emerald' : 'text-terracotta'}`}>
                        <AnimatedCurrency cents={monthResultCents} mode="slide" showSign />
                      </strong>
                    </div>
                  </div>

                  <div className="surface">
                    <div className="kpi-label">
                      <span>Faturas em Aberto</span>
                      <CreditCardIcon size={16} className="text-navy" />
                    </div>
                    <div className="kpi-value mono text-navy">
                      <AnimatedCurrency cents={totalOpenCardsCents} mode="slide" />
                    </div>
                    <div className="kpi-meta">Em {state.cards.length} cartão(ões)</div>
                  </div>
                </>
              )}
            </section>

            {overviewPrefs.showUpcoming && (
              <CollapsiblePanel
                title="Próximos Vencimentos"
                subtitle="Contas importantes com lembrete rápido"
                indexLabel="01/"
                storageKey="sf_panel_overview_upcoming_v1"
                defaultOpen={true}
                summary={<span className="tag tag-amber">{importantPendingTxs.length} pendentes</span>}
                headerAction={
                  <button type="button" className="btn btn-sm" onClick={() => setActiveTab('calendar')}>
                    Ver Agenda
                  </button>
                }
              >
                {importantPendingTxs.length === 0 ? (
                  <p className="section-desc">Tudo em dia! Nenhuma conta pendente.</p>
                ) : (
                  <div className="list-stack">
                    {importantPendingTxs.slice(0, 5).map((tx, idx) => (
                      <div key={tx.id} className="list-row stagger-item" style={{ animationDelay: `${idx * 55}ms` }}>
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
                            <AnimatedCurrency cents={tx.amountCents} mode="count" durationMs={750} />
                          </span>
                          {calStatus?.connected ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-icon-only"
                              title="Criar lembrete no Google Calendar"
                              aria-label={`Alertar ${tx.description} no Google Calendar`}
                              disabled={creatingAlert}
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
                              <Bell size={15} />
                            </button>
                          ) : (
                            <a
                              className="btn btn-sm btn-icon-only"
                              title="Agendar lembrete no Google Calendar"
                              aria-label={`Agendar ${tx.description} no Google Calendar`}
                              href={buildGoogleCalendarWebUrl({
                                summary: `[SuperFinance] Pagar ${tx.description} (${formatCentsBRL(tx.amountCents)})`,
                                date: tx.competenceDate,
                                description: `Categoria: ${tx.category}\nValor: ${formatCentsBRL(tx.amountCents)}`,
                              })}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Bell size={15} />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsiblePanel>
            )}

            {overviewPrefs.showCashflow && (
              <CollapsiblePanel
                title="Fluxo de Caixa (6 meses)"
                subtitle="Compare entradas e saídas em barras ou curvas"
                indexLabel="02/"
                storageKey="sf_panel_overview_cashflow_v1"
                defaultOpen={true}
                summary={
                  <span className={`mono ${monthResultCents >= 0 ? 'text-emerald' : 'text-terracotta'}`} style={{ fontWeight: 700, fontSize: 13 }}>
                    <AnimatedCurrency cents={monthResultCents} mode="slide" showSign />
                  </span>
                }
              >
                <CashflowChart transactions={state.transactions} currentYearMonth={currentYm} />
              </CollapsiblePanel>
            )}

            {overviewPrefs.showCategories && (
              <CollapsiblePanel
                title={`Gastos por Categoria (${currentYm})`}
                subtitle="Visualize a distribuição em pizza ou barras"
                indexLabel="03/"
                storageKey="sf_panel_overview_categories_v1"
                defaultOpen={true}
                summary={
                  <span className="mono text-terracotta" style={{ fontWeight: 700, fontSize: 13 }}>
                    <AnimatedCurrency cents={monthExpenseCents} mode="count" durationMs={750} />
                  </span>
                }
              >
                <CategoryChart items={categoryBreakdown} totalExpenseCents={monthExpenseCents} />
              </CollapsiblePanel>
            )}
          </div>
        )}

        {/* TAB: CONTAS */}
        {activeTab === 'accounts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="grid-3">
              {state.accounts.map((acc, idx) => {
                const bal = accountBalances.get(acc.id) ?? acc.initialBalanceCents;
                return (
                  <div key={acc.id} className="surface stagger-item" style={{ animationDelay: `${idx * 70}ms` }}>
                    <div className="kpi-label">
                      <span>{acc.institution}</span>
                      <span className="tag">{ACCOUNT_TYPE_LABELS[acc.type]}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>{acc.name}</div>
                    <div className={`kpi-value mono ${bal >= 0 ? 'text-emerald' : 'text-terracotta'}`}>
                      <AnimatedCurrency cents={bal} mode="count" />
                    </div>
                    <div className="kpi-meta">
                      Saldo inicial: <span className="mono">{formatCentsBRL(acc.initialBalanceCents)}</span>
                    </div>
                    <div className="card-actions-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleStartEditAccount(acc)}
                      >
                        <Pencil size={13} /> Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Excluir conta ${acc.name}`}
                        onClick={() => handleDeleteAccount(acc)}
                      >
                        <Trash2 size={14} /> Excluir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <CollapsiblePanel
              title={editingAccountId ? 'Editar Conta' : 'Adicionar Nova Conta'}
              subtitle="Cadastre ou atualize conta corrente, reserva, dinheiro ou investimento"
              indexLabel="01/"
              open={accFormOpen}
              onToggle={(next) => {
                setAccFormOpen(next);
                if (!next && editingAccountId) resetAccountForm();
              }}
              summary={<span className="tag">{editingAccountId ? 'Editando' : '+ Nova'}</span>}
            >
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
                  <label htmlFor="acc-inst">Banco / Instituição</label>
                  <input
                    id="acc-inst"
                    className="input"
                    placeholder="Ex.: Nubank, Itaú, XP..."
                    value={newAccInst}
                    onChange={(e) => setNewAccInst(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="acc-type">Tipo de Conta</label>
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
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  {editingAccountId && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        resetAccountForm();
                        setAccFormOpen(false);
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary">
                    <Plus size={15} /> {editingAccountId ? 'Salvar Alterações' : 'Cadastrar Conta'}
                  </button>
                </div>
              </form>
            </CollapsiblePanel>
          </div>
        )}

        {/* TAB: CARTÕES & FATURAS */}
        {activeTab === 'cards' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="grid-equal">
              {state.cards.map((card, idx) => {
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
                  <div
                    key={card.id}
                    className="stagger-item"
                    style={{ display: 'flex', flexDirection: 'column', gap: 12, animationDelay: `${idx * 80}ms` }}
                  >
                    <div className="credit-card-tile" style={{ background: card.accentColor }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.78 }}>{card.issuer}</div>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>{card.name}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="mono" style={{ fontSize: 13, opacity: 0.9 }}>
                            •••• {card.last4}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon-only"
                            style={{ background: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.24)', color: '#fff' }}
                            title="Editar cartão"
                            aria-label={`Editar cartão ${card.name}`}
                            onClick={() => handleStartEditCard(card)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-icon-only"
                            style={{ background: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.24)', color: '#fff' }}
                            title="Excluir cartão"
                            aria-label={`Excluir cartão ${card.name}`}
                            onClick={() => handleDeleteCard(card)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            Limite usado ({usagePct}%)
                            <InfoBalloon
                              title="Fechamento vs. Vencimento"
                              text={`Compras feitas antes do dia ${card.closingDay} entram na fatura atual; a partir do dia ${card.closingDay} vão para a próxima fatura, que vence todo dia ${card.dueDay}.`}
                              align="left"
                            />
                          </span>
                          <span className="mono">
                            Disponível: <AnimatedCurrency cents={availCents} mode="count" durationMs={850} />
                          </span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill progress-bar-anim" style={{ width: `${usagePct}%` }} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.9, flexWrap: 'wrap', gap: 6 }}>
                        <span>Fecha dia {card.closingDay}</span>
                        <span>Vence dia {card.dueDay}</span>
                        <span className="mono">Limite: {formatCentsBRL(card.limitCents)}</span>
                      </div>
                    </div>

                    <CollapsiblePanel
                      title={`Fatura ${stmtPeriod}`}
                      subtitle={`Vencimento ${stmtDueDate} • ${stmtTxs.length} compra(s)`}
                      storageKey={`sf_panel_card_${card.id}_v1`}
                      defaultOpen={false}
                      summary={
                        <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
                          <AnimatedCurrency cents={stmtCents} mode="slide" />
                        </span>
                      }
                    >
                      {stmtTxs.length === 0 ? (
                        <p className="section-desc" style={{ marginBottom: 14 }}>Nenhuma compra lançada nesta fatura.</p>
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
                          <Check size={14} /> Marcar como Paga
                        </button>
                        {calStatus?.connected ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-navy"
                            disabled={creatingAlert}
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
                            <Bell size={14} /> Lembrete no Calendar
                          </button>
                        ) : (
                          <a
                            className="btn btn-sm btn-navy"
                            href={buildGoogleCalendarWebUrl({
                              summary: `[SuperFinance] Vencimento Fatura ${card.name} (${formatCentsBRL(stmtCents)})`,
                              date: stmtDueDate,
                              description: `Fatura ${stmtPeriod} • Cartão ${card.name} (•••• ${card.last4})\nValor atual: ${formatCentsBRL(stmtCents)}`,
                            })}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Bell size={14} /> Lembrete no Calendar
                          </a>
                        )}
                      </div>
                    </CollapsiblePanel>
                  </div>
                );
              })}
            </div>

            <CollapsiblePanel
              title={editingCardId ? 'Editar Cartão de Crédito' : 'Adicionar Cartão de Crédito'}
              subtitle="Defina limite, dia de fechamento e vencimento da fatura"
              open={cardFormOpen}
              onToggle={(next) => {
                setCardFormOpen(next);
                if (!next && editingCardId) resetCardForm();
              }}
              summary={<span className="tag">{editingCardId ? 'Editando' : '+ Novo'}</span>}
            >
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
                  <label htmlFor="c-issuer">Banco / Emissor</label>
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
                <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  {editingCardId && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        resetCardForm();
                        setCardFormOpen(false);
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary">
                    <Plus size={15} /> {editingCardId ? 'Salvar Alterações' : 'Cadastrar Cartão'}
                  </button>
                </div>
              </form>
            </CollapsiblePanel>
          </div>
        )}

        {/* TAB: LANÇAMENTOS */}
        {activeTab === 'transactions' && (
          <div className="surface">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ flex: 1, minWidth: 180 }}
                placeholder="Buscar por descrição ou categoria..."
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                aria-expanded={showTxFilters}
                onClick={() => setShowTxFilters((v) => !v)}
              >
                <Filter size={15} />
                Filtros
                {(txFilterType !== 'all' || txFilterStatus !== 'all') && (
                  <span className="tag tag-navy" style={{ padding: '1px 6px' }}>Ativo</span>
                )}
              </button>
            </div>

            {showTxFilters && (
              <div className="filters-bar">
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
            )}

            {filteredTransactions.length === 0 ? (
              <p className="section-desc">Nenhum lançamento encontrado para os filtros aplicados.</p>
            ) : (
              <div className="list-stack">
                {filteredTransactions.map((tx) => {
                  const accountName = state.accounts.find((a) => a.id === tx.accountId)?.name;
                  const cardName = state.cards.find((c) => c.id === tx.creditCardId)?.name;
                  const isJustPaid = justPaidId === tx.id;
                  return (
                    <SwipeableTransactionRow
                      key={tx.id}
                      isPaid={tx.status === 'paid'}
                      justPaid={isJustPaid}
                      onSwipeRightPay={() => handleToggleTxStatus(tx.id)}
                      onSwipeLeftEdit={() => handleStartEditTx(tx)}
                    >
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
                          className={`btn btn-sm ${tx.status === 'paid' ? '' : 'btn-emerald'} ${isJustPaid ? 'paid-pop' : ''}`}
                          onClick={() => handleToggleTxStatus(tx.id)}
                        >
                          {tx.status === 'paid' && <Check size={13} />}
                          {tx.status === 'paid' ? 'Pago' : 'Pagar'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon-only"
                          title="Editar lançamento"
                          aria-label={`Editar ${tx.description}`}
                          onClick={() => handleStartEditTx(tx)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon-only"
                          title="Excluir lançamento"
                          aria-label={`Excluir ${tx.description}`}
                          onClick={() => handleDeleteTx(tx.id, tx.description)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </SwipeableTransactionRow>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB: CONTAS FIXAS (RECORRENTES) */}
        {activeTab === 'recurrences' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="surface">
              <div className="section-header">
                <div>
                  <h2 className="section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    Contas Fixas & Recorrentes
                    <InfoBalloon
                      title="Lançamento sem duplicidade"
                      text="Você pode clicar em 'Lançar' quantas vezes quiser: o sistema verifica quais contas já foram geradas no mês e cria apenas as que faltam."
                      align="left"
                    />
                  </h2>
                  <p className="section-desc">
                    Lance automaticamente suas contas fixas no mês sem risco de duplicar
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleRunRecurrenceEngine(currentYm)}
                  >
                    <Repeat size={14} /> Lançar {currentYm}
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
                {state.recurrences.map((rule) => {
                  const nextAlertDate = `${currentYm}-${String(Math.min(28, rule.dayOfMonth)).padStart(2, '0')}`;
                  return (
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
                          <span className="mono">Todo dia {rule.dayOfMonth}</span>
                        </div>
                      </div>
                      <div className="list-row-right">
                        <span
                          className={`mono ${rule.type === 'income' ? 'text-emerald' : 'text-terracotta'}`}
                          style={{ fontWeight: 700 }}
                        >
                          <AnimatedCurrency cents={rule.amountCents} mode="count" durationMs={750} />
                        </span>
                        {calStatus?.connected ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-navy"
                            disabled={creatingAlert}
                            onClick={() =>
                              void handleCreateCalendarAlert({
                                summary: `[SuperFinance] ${rule.title} (${formatCentsBRL(rule.amountCents)})`,
                                date: nextAlertDate,
                                description: `Conta fixa (${FREQ_LABELS[rule.frequency]}) • Categoria: ${rule.category}`,
                                recurringFreq: rule.frequency.toUpperCase() as 'MONTHLY' | 'WEEKLY' | 'YEARLY',
                                allDay: false,
                                colorId: '11',
                              })
                            }
                          >
                            <Bell size={13} /> Calendar
                          </button>
                        ) : (
                          <a
                            className="btn btn-sm btn-navy"
                            href={buildGoogleCalendarWebUrl({
                              summary: `[SuperFinance] ${rule.title} (${formatCentsBRL(rule.amountCents)})`,
                              date: nextAlertDate,
                              description: `Conta fixa (${FREQ_LABELS[rule.frequency]}) • Categoria: ${rule.category}`,
                            })}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Bell size={13} /> Calendar
                          </a>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon-only"
                          title="Editar conta fixa"
                          aria-label={`Editar ${rule.title}`}
                          onClick={() => handleStartEditRecurrence(rule)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon-only"
                          title="Excluir conta fixa"
                          aria-label={`Excluir ${rule.title}`}
                          onClick={() => handleDeleteRecurrence(rule)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <CollapsiblePanel
              title={editingRecId ? 'Editar Conta Fixa' : 'Nova Conta Fixa'}
              subtitle="Cadastre ou atualize contas fixas, assinaturas ou receitas mensais"
              open={recFormOpen}
              onToggle={(next) => {
                setRecFormOpen(next);
                if (!next && editingRecId) resetRecForm();
              }}
              summary={<span className="tag">{editingRecId ? 'Editando' : '+ Nova'}</span>}
            >
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
                    <option value="expense">Despesa / Dívida Fixa</option>
                    <option value="income">Receita Fixa</option>
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
                  <label htmlFor="r-day">Dia do Vencimento (1–31)</label>
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
                    Marcar como conta importante
                  </label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {editingRecId && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          resetRecForm();
                          setRecFormOpen(false);
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                    <button type="submit" className="btn btn-primary">
                      <Plus size={15} /> {editingRecId ? 'Salvar Alterações' : 'Cadastrar Conta Fixa'}
                    </button>
                  </div>
                </div>
              </form>
            </CollapsiblePanel>
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
        </div>
      </main>

      {/* Navegação Mobile fixa na zona do polegar com indicador deslizante (alvos >= 50px) */}
      <nav className="mobile-bottom-nav" aria-label="Navegação mobile">
        <div
          className="mobile-nav-pill"
          aria-hidden="true"
          style={{ transform: `translateX(${activeTabIdx * 100}%)` }}
        />
        <button
          type="button"
          className={`mobile-nav-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <LayoutDashboard size={19} />
          <span>Resumo</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          <Landmark size={19} />
          <span>Contas</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${activeTab === 'cards' ? 'active' : ''}`}
          onClick={() => setActiveTab('cards')}
        >
          <CreditCardIcon size={19} />
          <span>Cartões</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${activeTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          <ArrowUpRight size={19} />
          <span>Extrato</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${activeTab === 'recurrences' ? 'active' : ''}`}
          onClick={() => setActiveTab('recurrences')}
        >
          <Repeat size={19} />
          <span>Fixas</span>
        </button>
        <button
          type="button"
          className={`mobile-nav-btn ${activeTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setActiveTab('calendar')}
        >
          <CalendarClock size={19} />
          <span>Agenda</span>
          {importantPendingTxs.length > 0 && (
            <span className="mobile-nav-dot">{importantPendingTxs.length}</span>
          )}
        </button>
      </nav>

      {showNewTxModal && (
        <NewTransactionModal
          accounts={state.accounts}
          cards={state.cards}
          editingTransaction={editingTx}
          onClose={() => {
            setShowNewTxModal(false);
            setEditingTx(null);
          }}
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
