import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsiblePanelProps {
  title: string;
  subtitle?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (nextOpen: boolean) => void;
  headerAction?: ReactNode;
  children: ReactNode;
}

export function CollapsiblePanel({
  title,
  subtitle,
  summary,
  defaultOpen = true,
  open: controlledOpen,
  onToggle,
  headerAction,
  children,
}: CollapsiblePanelProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  function handleToggle() {
    const next = !isOpen;
    if (controlledOpen === undefined) {
      setInternalOpen(next);
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
            <h2 className="section-title">{title}</h2>
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
