import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { createCardInstallmentTransactions, getTodayIsoDate } from '../domain/ledger';
import { formatCentsBRL, parseBRLToCents, splitInstallmentsCents } from '../domain/money';
import type { Account, CreditCard, Transaction, TransactionStatus, TransactionType } from '../domain/types';

interface NewTransactionModalProps {
  accounts: readonly Account[];
  cards: readonly CreditCard[];
  onClose: () => void;
  onSave: (transactions: Transaction[], scheduleCalendarAlert: boolean) => void;
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
  'Outros',
];

export function NewTransactionModal({ accounts, cards, onClose, onSave }: NewTransactionModalProps) {
  const [type, setType] = useState<TransactionType>('expense');
  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [category, setCategory] = useState('Contas Fixas');
  const [competenceDate, setCompetenceDate] = useState(getTodayIsoDate());
  const [status, setStatus] = useState<TransactionStatus>('paid');
  const [paymentSource, setPaymentSource] = useState<'account' | 'card'>('account');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? accounts[0]?.id ?? '');
  const [creditCardId, setCreditCardId] = useState(cards[0]?.id ?? '');
  const [installments, setInstallments] = useState(1);
  const [important, setImportant] = useState(false);
  const [scheduleAlert, setScheduleAlert] = useState(false);
  const [error, setError] = useState('');

  const parsedCents = parseBRLToCents(amountInput);
  const previewSlices =
    type === 'expense' && paymentSource === 'card' && parsedCents > 0 && installments > 1
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
      setError('Escolha contas diferentes para origem e destino da transferência.');
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
      onSave(generated, scheduleAlert);
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

    onSave([tx], scheduleAlert);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-tx-title">
      <div className="modal-card">
        <div className="section-header" style={{ marginBottom: 14 }}>
          <div>
            <h2 id="new-tx-title" className="section-title">
              Novo Lançamento
            </h2>
            <p className="section-desc">Valores processados em centavos inteiros exatos (zero float)</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Fechar modal">
            <X size={18} />
          </button>
        </div>

        <div className="segmented" role="tablist">
          <button
            type="button"
            className={type === 'expense' ? 'active' : ''}
            onClick={() => setType('expense')}
          >
            Saída / Despesa
          </button>
          <button
            type="button"
            className={type === 'income' ? 'active' : ''}
            onClick={() => {
              setType('income');
              setPaymentSource('account');
              setCategory('Renda');
            }}
          >
            Entrada / Receita
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
              placeholder="Ex.: Conta de água, Compra supermercado, Salário..."
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
              <label htmlFor="tx-date">Data de Competência / Vencimento</label>
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
                      {n}x {n === 1 ? '(À vista na fatura)' : ''}
                    </option>
                  ))}
                </select>
              </div>
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
                    <option value="paid">Pago / Liquidado</option>
                    <option value="pending">Pendente / Agendado</option>
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
              Parcelamento exato:{' '}
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
              Marcar como conta importante (destaque nos próximos vencimentos)
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={scheduleAlert}
                onChange={(e) => setScheduleAlert(e.target.checked)}
              />
              Criar alerta imediato no Google Calendar (calendário financeiro separado)
            </label>
          </div>

          {error && (
            <div style={{ color: 'var(--accent-terracotta)', fontSize: 13, fontWeight: 600 }}>{error}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Salvar Lançamento
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
