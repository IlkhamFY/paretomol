import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; desc: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['↑', '←'], desc: 'Previous molecule' },
      { keys: ['↓', '→'], desc: 'Next molecule' },
      { keys: ['['], desc: 'Previous tab' },
      { keys: [']'], desc: 'Next tab' },
      { keys: ['1', '–', '9'], desc: 'Jump to tab 1–9' },
      { keys: ['0'], desc: 'Jump to last tab' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['/'], desc: 'Open AI Copilot' },
      { keys: ['s'], desc: 'Focus substructure search' },
      { keys: ['f'], desc: 'Toggle FDA reference overlay' },
      { keys: ['d'], desc: 'Toggle dark / light mode' },
      { keys: ['r'], desc: 'Reset / clear all' },
    ],
  },
  {
    title: 'Escape',
    shortcuts: [
      { keys: ['Esc'], desc: 'Close panel → clear substructure filter → deselect' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['?'], desc: 'Show this help' },
    ],
  },
];

export default function KeyboardShortcuts({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--overlay)] animate-fade-in"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border-10)] rounded-xl shadow-2xl w-[420px] max-w-[90vw] max-h-[80vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[15px] font-semibold text-[var(--text-heading)]">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-[var(--text2)] hover:text-[var(--text-heading)] rounded-md hover:bg-[var(--surface2)] transition-colors"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Groups */}
        <div className="px-5 pb-5 space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text2)]/60 mb-2">
                {group.title}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-[13px] text-[var(--text2)]">{s.desc}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((key, ki) => (
                        <span key={ki}>
                          {ki > 0 && key !== '–' && s.keys[ki - 1] !== '–' && (
                            <span className="text-[11px] text-[var(--text2)]/40 mx-0.5">/</span>
                          )}
                          {key === '–' ? (
                            <span className="text-[11px] text-[var(--text2)]/40 mx-0.5">–</span>
                          ) : (
                            <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-mono font-medium text-[var(--text)] bg-[var(--surface2)] border border-[var(--border-10)] rounded shadow-[0_1px_0_rgba(255,255,255,0.06)] leading-none">
                              {key}
                            </kbd>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
