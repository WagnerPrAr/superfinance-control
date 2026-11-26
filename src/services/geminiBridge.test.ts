import { describe, expect, it } from 'vitest';
import { buildInitialSeedState } from '../data/seedData';
import {
  buildCompactFinanceMarkdown,
  buildLowTokenGeminiPrompt,
  parseGeminiDeltaCommands,
} from './geminiBridge';

describe('geminiBridge', () => {
  it('builds a compact Markdown snapshot without leaking tokens', () => {
    const state = buildInitialSeedState();
    const md = buildCompactFinanceMarkdown(state, '2026-11');
    expect(md).toContain('format: compact-delta-v1');
    expect(md).toContain('## NOVOS LANCAMENTOS (DELTA)');
    expect(md).toContain('Patrimônio Líquido');
  });

  it('builds a low-token prompt listing accounts and cards', () => {
    const state = buildInitialSeedState();
    const prompt = buildLowTokenGeminiPrompt(state, '2026-11');
    expect(prompt.length).toBeLessThan(650);
    expect(prompt).toContain('+ YYYY-MM-DD');
  });

  it('parses Gemini delta lines into exact integer-cent transactions and matches cards/accounts', () => {
    const state = buildInitialSeedState();
    const sampleCard = state.cards[0];
    const sampleAcc = state.accounts[0];

    const raw = `
Aqui estão seus lançamentos:
+ 2026-11-26 | expense | Mercado Bairro | 85,50 | ${sampleCard.name} | Alimentação | pending
+ 2026-11-26 | income | Freela Design | 450,00 | ${sampleAcc.name} | Renda Extra | paid
`;

    const result = parseGeminiDeltaCommands(raw, state);
    expect(result.errors).toHaveLength(0);
    expect(result.transactions).toHaveLength(2);

    const [tx1, tx2] = result.transactions;
    expect(tx1.amountCents).toBe(8550);
    expect(tx1.creditCardId).toBe(sampleCard.id);
    expect(tx1.statementPeriod).toBeTruthy();

    expect(tx2.amountCents).toBe(45000);
    expect(tx2.type).toBe('income');
    expect(tx2.accountId).toBe(sampleAcc.id);
    expect(tx2.status).toBe('paid');
  });
});
