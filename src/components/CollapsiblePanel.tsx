import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsiblePanelProps {
  title: string;
  subtitle?: string;
  indexLabel?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  storageKey?: string;
  onToggle?: (nextOpen: boolean) => void;
  headerAction?: ReactNode;
  children: ReactNode;
}

export function CollapsiblePanel({
  title,
  subtitle,
  indexLabel,
  summary,
  defaultOpen = true,
  open: controlledOpen,
  storageKey,
  onToggle,
  headerAction,
  children,
}: CollapsiblePanelProps) {
  const [internalOpen, setInternalOpen] = useState<boolean>(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved !== null) return JSON.parse(saved) as boolean;
      } catch {
        // fallback
      }
    }
    return defaultOpen;
  });

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  function handleToggle() {
    const next = !isOpen;
    if (controlledOpen === undefined) {
      setInternalOpen(next);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
    }
    onToggle?.(next);
  }

  return (
    <section className="surface collapsible-surface">
      <div className="collapsible-header-row">
        <button
          type="button"
          className="collapsible-trigger"
          aria-expanded={isOpen}
          onClick={handleToggle}
        >
          <div className="collapsible-heading">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {indexLabel && <span className="craft-index mono">{indexLabel}</span>}
              <span>{title}</span>
            </h2>
            {subtitle && <p className="section-desc">{subtitle}</p>}
          </div>
          <div className="collapsible-right">
            {summary && <div className="collapsible-summary">{summary}</div>}
            <span className="collapsible-chevron" aria-hidden="true">
              {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </span>
          </div>
        </button>
        {headerAction && isOpen && <div className="collapsible-extra-action">{headerAction}</div>}
      </div>

      {isOpen && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
