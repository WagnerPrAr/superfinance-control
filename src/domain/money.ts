/**
 * Aritmética monetária estritamente em centavos inteiros (Zero IEEE-754 float).
 * Segue a skill `financial-ledger-recurrence-architect`.
 */

export function assertSafeCents(value: number, label = 'amountCents'): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} deve ser um inteiro seguro em centavos (recebido: ${value}).`);
  }
  return value;
}

export function addCents(a: number, b: number): number {
  return assertSafeCents(assertSafeCents(a, 'a') + assertSafeCents(b, 'b'), 'sum');
}

export function subtractCents(a: number, b: number): number {
  return assertSafeCents(assertSafeCents(a, 'a') - assertSafeCents(b, 'b'), 'diff');
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((acc, v) => addCents(acc, v), 0);
}

/**
 * Converte string monetária pt-BR ou decimal (ex.: "1.250,90", "1250.90", "45")
 * para centavos inteiros SEM usar aritmética de ponto flutuante.
 */
export function parseBRLToCents(raw: string): number {
  const cleaned = raw.replace(/[R$\s]/g, '').trim();
  if (!cleaned) return 0;

  const isNegative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/^[+-]/, '');

  let integerPart = '0';
  let fractionalPart = '00';

  if (unsigned.includes(',')) {
    // Formato pt-BR: ponto é separador de milhar, vírgula é decimal
    const parts = unsigned.split(',');
    integerPart = parts[0].replace(/\./g, '') || '0';
    fractionalPart = (parts[1] || '').replace(/\D/g, '').padEnd(2, '0').slice(0, 2);
  } else if (unsigned.includes('.')) {
    const parts = unsigned.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      // Formato decimal com ponto: "1250.90"
      integerPart = parts[0].replace(/\D/g, '') || '0';
      fractionalPart = parts[1].replace(/\D/g, '').padEnd(2, '0').slice(0, 2);
    } else {
      // Separador de milhar sem decimais: "1.250"
      integerPart = unsigned.replace(/\./g, '') || '0';
      fractionalPart = '00';
    }
  } else {
    integerPart = unsigned.replace(/\D/g, '') || '0';
    fractionalPart = '00';
  }

  const intDigits = integerPart.replace(/\D/g, '') || '0';
  const cents = Number.parseInt(intDigits, 10) * 100 + Number.parseInt(fractionalPart, 10);
  assertSafeCents(cents, 'parsedCents');
  return isNegative ? -cents : cents;
}

/**
 * Formata centavos inteiros em Real Brasileiro (R$ 1.234,56) sem dividir em float para cálculo.
 */
export function formatCentsBRL(cents: number, options?: { showSign?: boolean }): string {
  assertSafeCents(cents, 'formatCentsBRL');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const centavos = abs % 100;

  const reaisStr = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavosStr = String(centavos).padStart(2, '0');
  const sign = negative ? '-' : options?.showSign && cents > 0 ? '+' : '';
  return `${sign}R$ ${reaisStr},${centavosStr}`;
}

/**
 * Divide uma compra parcelada em N parcelas inteiras em centavos.
 * O resto de centavos indivisíveis é alocado deterministicamente na 1ª parcela
 * garantindo que a soma das parcelas seja EXATAMENTE igual ao valor total.
 */
export function splitInstallmentsCents(totalCents: number, installments: number): number[] {
  assertSafeCents(totalCents, 'totalCents');
  if (!Number.isInteger(installments) || installments < 1 || installments > 48) {
    throw new RangeError('Número de parcelas deve ser um inteiro entre 1 e 48.');
  }
  if (totalCents < 0) {
    throw new RangeError('totalCents para parcelamento não pode ser negativo.');
  }
  const base = Math.trunc(totalCents / installments);
  const remainder = totalCents % installments;
  const result: number[] = [];
  for (let i = 0; i < installments; i++) {
    result.push(i === 0 ? base + remainder : base);
  }
  return result;
}
