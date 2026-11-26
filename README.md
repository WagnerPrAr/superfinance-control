# SuperFinance — Controle Financeiro Pessoal & Alertas Google Calendar

Aplicação web moderna para controle financeiro pessoal construída sob a governança do **Skill Architect** (`SuperGravity`), combinando precisão contábil em centavos inteiros com integração real em um calendário separado do **Google Calendar**.

## Funcionalidades
- **Visão Geral:** Patrimônio líquido, fluxo de caixa mensal (Entradas vs. Saídas), gráfico comparativo de 6 meses, despesas por categoria e próximos vencimentos importantes.
- **Contas Bancárias & Reservas:** Gestão de contas corrente, poupança, dinheiro e investimentos com saldos calculados dinamicamente sobre transações liquidadas.
- **Cartões de Crédito & Faturas:** Separação estrita entre `closingDay` (fechamento) e `dueDay` (vencimento), compras parceladas alocadas explicitamente em faturas (`YYYY-MM`) com resto de centavos na 1ª parcela e controle de limite comprometido.
- **Entradas, Saídas & Transferências:** Lançamento rápido com busca, filtros por tipo/situação e liquidação em 1 clique.
- **Dívidas & Contas Recorrentes:** Motor idempotente (`ruleId::YYYY-MM`) que trata anos bissextos e meses de 28/29/30/31 dias sem jamais duplicar cobranças.
- **Google Calendar (Calendário Separado):** Bridge local segura (`shell: false`, `argv` validado) conectada a um calendário secundário dedicado (`SuperFinance — Alertas Financeiros (Teste)`), sem poluir sua agenda pessoal, com fallback `.ics`.

## Invariantes Arquiteturais
- **Zero Float (IEEE-754):** Todos os valores monetários são armazenados e calculados em inteiros seguros de centavos.
- **Segurança Hardened:** Execução do CLI `gcalendar` estritamente via `execFile` com `shell: false` e validação de entradas/allowlist.
- **Testes Determinísticos:** Suíte unitária em `vitest` cobrindo aritmética em centavos, parcelamentos, anos bissextos, faturas e idempotência.

## Como Executar
```bash
npm install
npm test
npm run dev
```

Configure `.env` a partir de `.env.example` para apontar para o ID do calendário secundário desejado.
