import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Info, X } from 'lucide-react';

interface InfoBalloonProps {
  title: string;
  text: string;
  extraDetails?: string;
  align?: 'left' | 'right' | 'center';
}

/**
 * Balão informativo expansível acessível para Desktop (hover/click) e Android Mobile (tap).
 * Permite visualizar um resumo imediato e expandir detalhes extras sob demanda.
 */
export function InfoBalloon({ title, text, extraDetails, align = 'center' }: InfoBalloonProps) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const popoverId = useId();

  const open = pinned || hovered;

  useEffect(() => {
    if (!open) return;

    function handleOutside(e: MouseEvent | TouchEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPinned(false);
        setHovered(false);
        setExpanded(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPinned(false);
        setHovered(false);
        setExpanded(false);
      }
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

  function handleMouseEnter() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHovered(true);
  }

  function handleMouseLeave() {
    closeTimerRef.current = window.setTimeout(() => {
      setHovered(false);
    }, 140);
  }

  return (
    <span
      ref={rootRef}
      className="info-balloon-anchor"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className={`info-balloon-trigger ${open ? 'active' : ''}`}
        aria-label={`Explicação sobre ${title}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => {
            const next = !v;
            if (!next) {
              setHovered(false);
              setExpanded(false);
            }
            return next;
          });
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
              onClick={() => {
                setPinned(false);
                setHovered(false);
                setExpanded(false);
              }}
            >
              <X size={13} />
            </button>
          </div>
          <p className="info-balloon-body">{text}</p>

          {extraDetails && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="info-balloon-expand-btn"
                onClick={() => {
                  setPinned(true);
                  setExpanded((v) => !v);
                }}
              >
                {expanded ? (
                  <>
                    Ocultar detalhes <ChevronUp size={13} />
                  </>
                ) : (
                  <>
                    Expandir detalhes <ChevronDown size={13} />
                  </>
                )}
              </button>
              {expanded && <p className="info-balloon-extra">{extraDetails}</p>}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
