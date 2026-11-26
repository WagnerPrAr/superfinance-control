import { useEffect, useRef, useState } from 'react';
import { formatCentsBRL } from '../domain/money';

interface AnimatedCurrencyProps {
  cents: number;
  mode?: 'count' | 'slide';
  showSign?: boolean;
  className?: string;
  durationMs?: number;
  animateOnMount?: boolean;
}

/**
 * Exibe valores monetários em centavos inteiros com animação fluida e visível:
 * - mode="count": contagem numérica suave via requestAnimationFrame (~950ms easeOutQuart)
 * - mode="slide": entrada/saída vertical (slide-in/out com bounce suave ~520ms)
 */
export function AnimatedCurrency({
  cents,
  mode = 'count',
  showSign = false,
  className = '',
  durationMs = 950,
  animateOnMount = true,
}: AnimatedCurrencyProps) {
  const [displayCents, setDisplayCents] = useState(() => (animateOnMount && mode === 'count' ? 0 : cents));
  const [slideKey, setSlideKey] = useState(0);
  const [slideDir, setSlideDir] = useState<'up' | 'down'>('up');
  const prevCentsRef = useRef<number>(animateOnMount && mode === 'count' ? 0 : cents);
  const mountedRef = useRef(false);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const from = prevCentsRef.current;

    if (!mountedRef.current) {
      mountedRef.current = true;
      if (prefersReduced) {
        prevCentsRef.current = cents;
        setDisplayCents(cents);
        return;
      }
      if (mode === 'slide') {
        if (animateOnMount) {
          setSlideDir(cents >= 0 ? 'up' : 'down');
          setSlideKey(1);
        }
        setDisplayCents(cents);
        prevCentsRef.current = cents;
        return;
      }
      if (!animateOnMount) {
        prevCentsRef.current = cents;
        setDisplayCents(cents);
        return;
      }
    } else if (from === cents) {
      return;
    }

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

    const startVal = from;
    const startTime = performance.now();
    let rafId = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutQuart: começo rápido e desaceleração longa e visível
      const eased = 1 - Math.pow(1 - t, 4);
      const current = Math.round(startVal + (cents - startVal) * eased);
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
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [cents, mode, durationMs, animateOnMount]);

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
