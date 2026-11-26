import { useEffect, useId, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';

interface InfoBalloonProps {
  title: string;
  text: string;
  align?: 'left' | 'right' | 'center';
}

/**
 * Balão informativo acessível para Desktop (hover/click) e Android Mobile (tap >= 44px).
 */
export function InfoBalloon({ title, text, align = 'center' }: InfoBalloonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;

    function handleOutside(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="info-balloon-anchor">
      <button
        type="button"
        className={`info-balloon-trigger ${open ? 'active' : ''}`}
        aria-label={`Explicação sobre ${title}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Info size={14} />
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={title}
          className={`info-balloon-popover info-balloon-${align}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="info-balloon-head">
            <strong>{title}</strong>
            <button
              type="button"
              className="info-balloon-close"
              aria-label="Fechar balão"
              onClick={() => setOpen(false)}
            >
              <X size={13} />
            </button>
          </div>
          <p className="info-balloon-body">{text}</p>
        </div>
      )}
    </span>
  );
}
