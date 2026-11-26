import { useEffect, useRef, useState } from 'react';
import { formatCentsBRL } from '../domain/money';

interface AnimatedCurrencyProps {
  cents: number;
  mode?: 'count' | 'slide';
  showSign?: boolean;
  className?: string;
}

/**
 * Exibe valores monetários em centavos inteiros com animação fluida:
 * - mode="count": contagem numérica suave via requestAnimationFrame (~340ms)
 * - mode="slide": entrada/saída vertical (slide-in/out com leve bounce)
 */
export function AnimatedCurrency({
  cents,
  mode = 'count',
  showSign = false,
  className = '',
}: AnimatedCurrencyProps) {
  const [displayCents, setDisplayCents] = useState(cents);
  const [slideKey, setSlideKey] = useState(0);
  const [slideDir, setSlideDir] = useState<'up' | 'down'>('up');
  const prevCentsRef = useRef(cents);

  useEffect(() => {
    const from = prevCentsRef.current;
    if (from === cents) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      prevCentsRef.current = cents;
      setDisplayCents(cents);
      return;
    }

    if (mode === 'slide') {
      setSlideDir(cents >= from ? 'up' : 'down');
      setSlideKey((k) => k + 1);
      setDisplayCents(cents);
      prevCentsRef.current = cents;
      return;
    }

    // mode === 'count' (interpolação em centavos inteiros)
    const duration = 340;
    const startTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // easeOutBack sutil para sensação viva sem exagerar nos números
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (cents - from) * eased);
      setDisplayCents(current);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplayCents(cents);
        prevCentsRef.current = cents;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      prevCentsRef.current = cents;
    };
  }, [cents, mode]);

  if (mode === 'slide') {
    return (
      <span className={`num-slide-wrap ${className}`}>
        <span
          key={slideKey}
          className={`num-slide-inner ${slideKey > 0 ? (slideDir === 'up' ? 'num-slide-up' : 'num-slide-down') : ''}`}
        >
          {formatCentsBRL(displayCents, { showSign })}
        </span>
      </span>
    );
  }

  return <span className={className}>{formatCentsBRL(displayCents, { showSign })}</span>;
}
