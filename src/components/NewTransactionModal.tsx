import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { createCardInstallmentTransactions, getTodayIsoDate } from '../domain/ledger';
import { formatCentsBRL, parseBRLToCents, splitInstallmentsCents } from '../domain/money';
import type { Account, CreditCard, Transaction, TransactionStatus, TransactionType } from '../domain/types';

interface NewTransactionModalProps {
  accounts: readonly Account[];
  cards: readonly CreditCard[];
  editingTransaction?: Transaction | null;
  onClose: () => void;
  onSave: (transactions: Transaction[], scheduleCalendarAlert: boolean, isEdit?: boolean) => void;
}

const DRAFT_KEY = 'sf_new_tx_draft_v1';

interface TxDraft {
  type: TransactionType;
  description: string;
  amountInput: string;
  category: string;
  competenceDate: string;
  status: TransactionStatus;
  paymentSource: 'account' | 'card';
  accountId: string;
  toAccountId: string;
  creditCardId: string;
  installments: number;
  important: boolean;
  scheduleAlert: boolean;
}

function loadDraft(): Partial<TxDraft> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<TxDraft>) : {};
  } catch {
    return {};
  }
}

const CATEGORIES = [
  'Alimentação',
  'Moradia',
  'Contas Fixas',
  'Dívidas & Parcelas',
  'Transporte',
  'Saúde',
  'Tecnologia',
  'Lazer',
  'Educação',
  'Renda',
  'Renda Extra',
  'Investimentos',
  'Fatura Cartão',
  'Outros',
];

function centsToInput(cents: number): string {
  const reais = Math.trunc(Math.abs(cents) / 100);
  const centavos = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${reais},${centavos}`;
}

export function NewTransactionModal({
  accounts,
  cards,
  editingTransaction,
  onClose,
  onSave,
}: NewTransactionModalProps) {
  const isEditing = Boolean(editingTransaction);
  const draft = isEditing ? {} : loadDraft();

  const [type, setType] = useState<TransactionType>(editingTransaction?.type ?? draft.type ?? 'expense');
  const [description, setDescription] = useState(editingTransaction?.description ?? draft.description ?? '');
  const [amountInput, setAmountInput] = useState(
    editingTransaction ? centsToInput(editingTransaction.amountCents) : draft.amountInput ?? '',
  );
  const [category, setCategory] = useState(editingTransaction?.category ?? draft.category ?? 'Contas Fixas');
  const [competenceDate, setCompetenceDate] = useState(
    editingTransaction?.competenceDate ?? draft.competenceDate ?? getTodayIsoDate(),
  );
  const [status, setStatus] = useState<TransactionStatus>(editingTransaction?.status ?? draft.status ?? 'paid');
  const [paymentSource, setPaymentSource] = useState<'account' | 'card'>(
    editingTransaction ? (editingTransaction.creditCardId ? 'card' : 'account') : (draft.paymentSource ?? 'account'),
  );
  const [accountId, setAccountId] = useState(
    editingTransaction?.accountId ?? draft.accountId ?? accounts[0]?.id ?? '',
  );
  const [toAccountId, setToAccountId] = useState(
    editingTransaction?.toAccountId ?? draft.toAccountId ?? accounts[1]?.id ?? accounts[0]?.id ?? '',
  );
  const [creditCardId, setCreditCardId] = useState(
    editingTransaction?.creditCardId ?? draft.creditCardId ?? cards[0]?.id ?? '',
  );
  const [installments, setInstallments] = useState(draft.installments ?? 1);
  const [important, setImportant] = useState(
    editingTransaction ? Boolean(editingTransaction.important) : Boolean(draft.important),
  );
  const [scheduleAlert, setScheduleAlert] = useState(Boolean(draft.scheduleAlert));
  const [error, setError] = useState('');

  useEffect(() => {
    if (isEditing) return;
    try {
      const nextDraft: TxDraft = {
        type,
        description,
        amountInput,
        category,
        competenceDate,
        status,
        paymentSource,
        accountId,
        toAccountId,
        creditCardId,
        installments,
        important,
        scheduleAlert,
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(nextDraft));
    } catch {
      // ignore
    }
  }, [
    isEditing,
    type,
    description,
    amountInput,
    category,
    competenceDate,
    status,
    paymentSource,
    accountId,
    toAccountId,
    creditCardId,
    installments,
    important,
    scheduleAlert,
  ]);

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  const parsedCents = parseBRLToCents(amountInput);
  const previewSlices =
    !isEditing && type === 'expense' && paymentSource === 'card' && parsedCents > 0 && installments > 1
      ? splitInstallmentsCents(parsedCents, installments)
      : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!description.trim()) {
      setError('Informe uma descrição para o lançamento.');
      return;
    }
    if (parsedCents <= 0) {
      setError('Informe um valor maior que zero.');
      return;
    }
    if (type === 'transfer' && accountId === toAccountId) {
      setError('Escolha contas diferentes para origem e destino.');
      return;
    }

    if (isEditing && editingTransaction) {
      const updated: Transaction = {
        ...editingTransaction,
        description: description.trim(),
        category: type === 'transfer' ? 'Transferência' : category,
        amountCents: parsedCents,
        type,
        competenceDate,
        status,
        accountId: paymentSource === 'card' ? undefined : accountId,
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        creditCardId: type === 'expense' && paymentSource === 'card' ? creditCardId : undefined,
        important,
      };
      onSave([updated], scheduleAlert, true);
      return;
    }

    const idPrefix = `tx-${Date.now()}`;
    const nowUtc = new Date().toISOString();

    if (type === 'expense' && paymentSource === 'card') {
      const card = cards.find((c) => c.id === creditCardId);
      if (!card) {
        setError('Selecione um cartão de crédito válido.');
        return;
      }
      const generated = createCardInstallmentTransactions({
        idPrefix,
        description: description.trim(),
        category,
        totalAmountCents: parsedCents,
        installments,
        purchaseDate: competenceDate,
        card,
        important,
      });
      clearDraft();
      onSave(generated, scheduleAlert, false);
      return;
    }

    const tx: Transaction = {
      id: idPrefix,
      description: description.trim(),
      category: type === 'transfer' ? 'Transferência' : category,
      amountCents: parsedCents,
      type,
      competenceDate,
      status,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      important,
      createdAtUtc: nowUtc,
    };

    clearDraft();
    onSave([tx], scheduleAlert, false);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-tx-title">
      <div className="modal-card">
        <div className="section-header" style={{ marginBottom: 14 }}>
          <div>
            <h2 id="new-tx-title" className="section-title">
              {isEditing ? 'Editar Lançamento' : 'Novo Lançamento'}
            </h2>
            <p className="section-desc">
              {isEditing
                ? 'Atualize os dados deste lançamento financeiro'
                : 'Registre uma entrada, saída ou transferência'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon-only" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="segmented" role="tablist">
          <button
            type="button"
            className={type === 'expense' ? 'active' : ''}
            onClick={() => setType('expense')}
          >
            Despesa
          </button>
          <button
            type="button"
            className={type === 'income' ? 'active' : ''}
            onClick={() => {
              setType('income');
              setPaymentSource('account');
              if (!isEditing) setCategory('Renda');
            }}
          >
            Receita
          </button>
          <button
            type="button"
            className={type === 'transfer' ? 'active' : ''}
            onClick={() => {
              setType('transfer');
              setPaymentSource('account');
            }}
          >
            Transferência
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label htmlFor="tx-desc">Descrição</label>
            <input
              id="tx-desc"
              className="input"
              placeholder="Ex.: Conta de água, Supermercado, Salário..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="tx-amount">Valor (R$)</label>
              <input
                id="tx-amount"
                className="input mono"
                placeholder="0,00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-date">Data</label>
              <input
                id="tx-date"
                type="date"
                className="input mono"
                value={competenceDate}
                onChange={(e) => setCompetenceDate(e.target.value)}
              />
            </div>
          </div>

          {type === 'expense' && cards.length > 0 && (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="tx-source">Forma de Pagamento</label>
                <select
                  id="tx-source"
                  className="select"
                  value={paymentSource}
                  onChange={(e) => setPaymentSource(e.target.value as 'account' | 'card')}
                >
                  <option value="account">Conta Bancária / Dinheiro</option>
                  <option value="card">Cartão de Crédito</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="tx-cat">Categoria</label>
                <select
                  id="tx-cat"
                  className="select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {type === 'income' && (
            <div className="field">
              <label htmlFor="tx-cat-inc">Categoria</label>
              <select
                id="tx-cat-inc"
                className="select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {type === 'expense' && paymentSource === 'card' ? (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="tx-card">Cartão de Crédito</label>
                <select
                  id="tx-card"
                  className="select"
                  value={creditCardId}
                  onChange={(e) => setCreditCardId(e.target.value)}
                >
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (•••• {c.last4}) — Fecha dia {c.closingDay}
                    </option>
                  ))}
                </select>
              </div>
              {!isEditing && (
                <div className="field">
                  <label htmlFor="tx-inst">Parcelas</label>
                  <select
                    id="tx-inst"
                    className="select"
                    value={installments}
                    onChange={(e) => setInstallments(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24].map((n) => (
                      <option key={n} value={n}>
                        {n}x {n === 1 ? '(À vista)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="tx-acc">{type === 'transfer' ? 'Conta de Origem' : 'Conta'}</label>
                <select
                  id="tx-acc"
                  className="select"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.institution})
                    </option>
                  ))}
                </select>
              </div>

              {type === 'transfer' ? (
                <div className="field">
                  <label htmlFor="tx-to-acc">Conta de Destino</label>
                  <select
                    id="tx-to-acc"
                    className="select"
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.institution})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="tx-status">Situação</label>
                  <select
                    id="tx-status"
                    className="select"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TransactionStatus)}
                  >
                    <option value="paid">Pago</option>
                    <option value="pending">Pendente</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {previewSlices && (
            <div
              style={{
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 12.5,
                color: 'var(--ink-secondary)',
              }}
            >
              Parcelamento:{' '}
              <strong className="mono" style={{ color: 'var(--ink-primary)' }}>
                1ª de {formatCentsBRL(previewSlices[0])}
              </strong>{' '}
              + {previewSlices.length - 1}x de{' '}
              <strong className="mono" style={{ color: 'var(--ink-primary)' }}>
                {formatCentsBRL(previewSlices[1])}
              </strong>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={important}
                onChange={(e) => setImportant(e.target.checked)}
              />
              Marcar como conta importante
            </label>
            {!isEditing && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={scheduleAlert}
                  onChange={(e) => setScheduleAlert(e.target.checked)}
                />
                Criar lembrete automático no Google Calendar
              </label>
            )}
          </div>

          {error && (
            <div style={{ color: 'var(--accent-terracotta)', fontSize: 13, fontWeight: 600 }}>{error}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              {isEditing ? 'Salvar Alterações' : 'Salvar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
