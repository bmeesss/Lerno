/**
 * Small dropdown menu used for the Lerno AI actions on sets and cards.
 * Keyboard accessible: Escape closes, focus returns to the trigger, and items
 * are real buttons inside `role="menu"`.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconSparkles } from '../ui/Icons';

export interface AiMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

interface AiMenuProps {
  label?: string;
  items: AiMenuItem[];
  /** Compact variant for card-level actions. */
  compact?: boolean;
  disabled?: boolean;
  title?: string;
}

export function AiMenu({ label = 'Vraag Lerno AI', items, compact, disabled, title }: AiMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent): void {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ai-menu-wrap" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={compact ? 'ai-menu-trigger ai-menu-trigger-compact' : 'ai-menu-trigger'}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={title}
      >
        <IconSparkles size={compact ? 14 : 16} />
        {compact ? <span className="sr-only">{label}</span> : <span>{label}</span>}
      </button>

      {open ? (
        <div className="ai-menu" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="ai-menu-item"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <span className="ai-menu-item-icon">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
