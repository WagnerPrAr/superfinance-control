import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
  CheckCircle2,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { FinanceState, Transaction } from '../domain/types';
import {
  buildCompactFinanceMarkdown,
  buildLowTokenGeminiPrompt,
  clearGeminiConfig,
  DEFAULT_GEMINI_CONFIG,
  downloadGeminiMarkdownFile,
  GEMINI_APP_URL,
  parseGeminiDeltaCommands,
  saveGeminiConfig,
  saveGeminiMarkdownToDevice,
  type GeminiIntegrationConfig,
  type GeminiStorageTarget,
} from '../services/geminiBridge';
import { triggerHaptic } from '../utils/androidBridge';

interface GeminiIntegrationModalProps {
  state: FinanceState;
  currentYm: string;
  config: GeminiIntegrationConfig;
  onConfigChange: (next: GeminiIntegrationConfig) => void;
  onApplyTransactions: (txs: Transaction[]) => void;
  onNotify: (message: string) => void;
  onClose: () => void;
}

export function GeminiIntegrationModal({
  state,
  currentYm,
  config,
  onConfigChange,
  onApplyTransactions,
  onNotify,
  onClose,
}: GeminiIntegrationModalProps) {
  const [step, setStep] = useState<'setup' | 'guide'>(config.authorized ? 'guide' : 'setup');
  const [storageTarget, setStorageTarget] = useState<GeminiStorageTarget>(config.storageTarget);
  const [consentChecked, setConsentChecked] = useState<boolean>(config.authorized);
  const [busy, setBusy] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [deltaInput, setDeltaInput] = useState('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  const compactMd = useMemo(() => buildCompactFinanceMarkdown(state, currentYm), [state, currentYm]);
  const starterPrompt = useMemo(() => buildLowTokenGeminiPrompt(state, currentYm), [state, currentYm]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleAuthorizeAndSetup() {
    if (!consentChecked) return;
    setBusy(true);
    try {
      const writeResult = await saveGeminiMarkdownToDevice(compactMd, storageTarget);
      const nowUtc = new Date().toISOString();
      const nextConfig: GeminiIntegrationConfig = {
        ...config,
        authorized: true,
        authorizedAtUtc: config.authorizedAtUtc ?? nowUtc,
        storageTarget,
        lastSyncedAtUtc: nowUtc,
        lastSyncLocation: writeResult.locationLabel,
      };
      await saveGeminiConfig(nextConfig);
      onConfigChange(nextConfig);
      triggerHaptic('success');

      if (!writeResult.savedNatively && storageTarget === 'local') {
        downloadGeminiMarkdownFile(compactMd);
      }
      onNotify(
        storageTarget === 'drive'
          ? 'Integração autorizada! Arquivo .md preparado para o Google Drive.'
          : `Integração autorizada! Arquivo salvo em ${writeResult.locationLabel}.`,
      );
      setStep('guide');
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshMarkdown() {
    setBusy(true);
    try {
      const writeResult = await saveGeminiMarkdownToDevice(compactMd, config.storageTarget);
      const nextConfig: GeminiIntegrationConfig = {
        ...config,
        lastSyncedAtUtc: new Date().toISOString(),
        lastSyncLocation: writeResult.locationLabel,
      };
      await saveGeminiConfig(nextConfig);
      onConfigChange(nextConfig);
      triggerHaptic('light');
      onNotify(`Snapshot .md atualizado (${writeResult.locationLabel}).`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyStarterPrompt() {
    try {
      await navigator.clipboard?.writeText(starterPrompt);
      setCopiedPrompt(true);
      triggerHaptic('light');
      window.setTimeout(() => setCopiedPrompt(false), 2600);
      onNotify('Comando inicial ultra-enxuto copiado! Cole no Gemini.');
    } catch {
      onNotify('Selecione e copie o bloco de comando abaixo.');
    }
  }

  async function handleOpenGemini() {
    triggerHaptic('medium');
    try {
      await navigator.clipboard?.writeText(starterPrompt);
    } catch {
      // Continua abrindo o Gemini mesmo sem clipboard
    }
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: GEMINI_APP_URL });
    } else {
      window.open(GEMINI_APP_URL, '_blank', 'noopener,noreferrer');
    }
    onNotify('Gemini aberto! O comando inicial já foi copiado para colar.');
  }

  function handleImportMarkdownFile(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setDeltaInput(text);
      setParseErrors([]);
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  async function handleApplyDelta() {
    const { transactions, errors } = parseGeminiDeltaCommands(deltaInput, state);
    setParseErrors(errors);
    if (transactions.length === 0) return;

    onApplyTransactions(transactions);
    setDeltaInput('');
    triggerHaptic('success');

    // Atualiza automaticamente o arquivo .md após aplicar os lançamentos
    const updatedState: FinanceState = {
      ...state,
      transactions: [...transactions, ...state.transactions],
    };
    const refreshedMd = buildCompactFinanceMarkdown(updatedState, currentYm);
    const writeResult = await saveGeminiMarkdownToDevice(refreshedMd, config.storageTarget);
    const nextConfig: GeminiIntegrationConfig = {
      ...config,
      lastSyncedAtUtc: new Date().toISOString(),
      lastSyncLocation: writeResult.locationLabel,
    };
    await saveGeminiConfig(nextConfig);
    onConfigChange(nextConfig);
    onNotify(`${transactions.length} lançamento(s) do Gemini aplicado(s) e .md atualizado!`);
  }

  async function handleRevoke() {
    await clearGeminiConfig();
    onConfigChange(DEFAULT_GEMINI_CONFIG);
    setConsentChecked(false);
    setStep('setup');
    onNotify('Integração com o Gemini desconectada.');
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Integração SuperFinance + Gemini" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: 'var(--accent-navy-soft)',
                color: 'var(--accent-navy)',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <Sparkles size={19} />
            </div>
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>
                {step === 'setup' ? 'Conectar SuperFinance ao Gemini' : 'Lançar Finanças com o Gemini'}
              </h2>
              <p className="section-desc" style={{ margin: '2px 0 0', fontSize: 12.5 }}>
                {step === 'setup'
                  ? 'Integração híbrida econômica (~180 tokens) para conta gratuita ou paga'
                  : `Modo ativo: ${config.storageTarget === 'drive' ? 'Google Drive (.md)' : 'Arquivo Local (.md)'}`}
              </p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-icon-only" aria-label="Fechar modal Gemini" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {step === 'setup' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-primary)' }}>
                1. Escolha onde salvar o arquivo compacto (.md)
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                <button
                  type="button"
                  className="surface"
                  style={{
                    textAlign: 'left',
                    padding: 14,
                    cursor: 'pointer',
                    borderColor: storageTarget === 'local' ? 'var(--accent-navy)' : 'var(--border-subtle)',
                    boxShadow: storageTarget === 'local' ? '0 0 0 2px var(--accent-navy-soft)' : 'none',
                  }}
                  onClick={() => setStorageTarget('local')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5 }}>
                    <HardDrive size={16} className="text-navy" />
                    Arquivo Local (.md)
                  </div>
                  <p className="section-desc" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    Salva direto no aparelho (<code>SuperFinance/superfinance-gemini.md</code>). 100% offline e compatível com Gemini gratuito.
                  </p>
                </button>

                <button
                  type="button"
                  className="surface"
                  style={{
                    textAlign: 'left',
                    padding: 14,
                    cursor: 'pointer',
                    borderColor: storageTarget === 'drive' ? 'var(--accent-navy)' : 'var(--border-subtle)',
                    boxShadow: storageTarget === 'drive' ? '0 0 0 2px var(--accent-navy-soft)' : 'none',
                  }}
                  onClick={() => setStorageTarget('drive')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5 }}>
                    <Cloud size={16} className="text-emerald" />
                    Google Drive (.md)
                  </div>
                  <p className="section-desc" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    Mantém o snapshot <code>.md</code> pronto para pasta dedicada no Drive e anexo rápido no app/web do Gemini.
                  </p>
                </button>
              </div>
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: 'var(--bg-muted)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
                <Lock size={14} className="text-emerald" />
                2. Autorização de Integração & Segurança
              </div>
              <label className="checkbox-row" style={{ fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                />
                Autorizo conectar o SuperFinance ao Gemini usando um arquivo <code>.md</code> compacto e sanitizado (sem senhas, tokens OAuth ou dados bancários completos).
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!consentChecked || busy}
                onClick={() => void handleAuthorizeAndSetup()}
              >
                <ShieldCheck size={15} />
                {busy ? 'Configurando...' : 'Autorizar e Configurar'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Banner de status + guia de 3 passos */}
            <div
              style={{
                padding: 13,
                borderRadius: 12,
                background: 'var(--bg-muted)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span className="tag tag-emerald">
                  <CheckCircle2 size={12} /> Integração Autorizada
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                  {config.lastSyncLocation || 'superfinance-gemini.md'}
                </span>
              </div>

              <strong style={{ fontSize: 13, marginTop: 2 }}>
                Como iniciar o comando no Gemini (economia máxima de tokens):
              </strong>
              <ol style={{ margin: '0 0 0 18px', padding: 0, fontSize: 12.5, color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <li>
                  Toque em <strong>Abrir Gemini</strong> abaixo — o comando inicial (~180 tokens) já será copiado automaticamente com suas contas e cartões.
                </li>
                <li>
                  Cole no Gemini e fale ou digite seus gastos/receitas (ex.: <em>"Gastei 85,50 no mercado hoje no Nubank"</em>). Ele responderá apenas em linhas <code>+ ...</code>.
                </li>
                <li>
                  Copie as linhas <code>+ ...</code> geradas pelo Gemini, cole no campo abaixo e toque em <strong>Aplicar no SuperFinance</strong>.
                </li>
              </ol>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleOpenGemini()}>
                  <ExternalLink size={14} />
                  Abrir Gemini (Copia Comando)
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void handleCopyStarterPrompt()}>
                  <Copy size={14} />
                  {copiedPrompt ? 'Comando Copiado!' : 'Copiar Comando Inicial'}
                </button>
              </div>
            </div>

            {/* Caixa para colar linhas delta do Gemini ou importar .md */}
            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label htmlFor="gemini-delta-input">Colar resposta do Gemini (linhas iniciadas com +)</label>
                <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer', minHeight: 32, padding: '4px 8px', fontSize: 11.5 }}>
                  <Upload size={12} />
                  Importar .md
                  <input type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={handleImportMarkdownFile} />
                </label>
              </div>
              <textarea
                id="gemini-delta-input"
                className="input mono"
                rows={4}
                style={{ fontSize: 12, lineHeight: 1.45, resize: 'vertical' }}
                placeholder={`+ ${currentYm}-26 | expense | Mercado | 85,50 | Nubank | Alimentação | paid`}
                value={deltaInput}
                onChange={(e) => setDeltaInput(e.target.value)}
              />
              {parseErrors.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--accent-terracotta)', marginTop: 4 }}>
                  {parseErrors.map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void handleRefreshMarkdown()}>
                  <RefreshCw size={13} />
                  Atualizar .md
                </button>
                <button type="button" className="btn btn-sm" onClick={() => downloadGeminiMarkdownFile(compactMd)}>
                  <Download size={13} />
                  Baixar .md
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('setup')}>
                  Trocar Local/Drive
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleRevoke()}>
                  Desativar
                </button>
              </div>

              <button
                type="button"
                className="btn btn-navy btn-sm"
                disabled={!deltaInput.trim()}
                onClick={() => void handleApplyDelta()}
              >
                <Sparkles size={14} />
                Aplicar no SuperFinance
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
