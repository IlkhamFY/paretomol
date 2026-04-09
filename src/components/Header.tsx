import { useState, useRef, useEffect } from 'react';
import { Download, FileText, MessageSquare, MoreHorizontal, ChevronDown, Menu, X, Sun, Moon } from 'lucide-react';

const GitHubIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);
import { useTheme } from '../contexts/ThemeContext';

interface HeaderProps {
  moleculeCount: number;
  onReset?: () => void;
  onExportCSV?: () => void;
  onExportJSON?: () => void;
  onExportSDF?: () => void;
  onExportSDFPareto?: () => void;
  onExportFigure?: () => void;
  onExportSummaryReport?: () => void;
  onShareURL?: () => void;
  onCite?: () => void;
  onDocs?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export default function Header({ moleculeCount, onReset, onExportCSV, onExportJSON, onExportSDF, onExportSDFPareto, onExportFigure, onExportSummaryReport, onCite, onDocs, sidebarOpen, onToggleSidebar }: HeaderProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const exportActions = [
    { label: 'Figure (PNG)', onClick: onExportFigure },
    { label: 'CSV', onClick: onExportCSV },
    { label: 'SDF (Pareto only)', onClick: onExportSDFPareto },
    { label: 'SDF (all)', onClick: onExportSDF },
    { label: 'JSON', onClick: onExportJSON },
    { label: 'Summary Report (MD)', onClick: onExportSummaryReport },
  ];

  const allActions = [
    { icon: <Download size={14} />, label: 'Export Figure', onClick: onExportFigure },
    { icon: <Download size={14} />, label: 'Export CSV', onClick: onExportCSV },
    { icon: <Download size={14} />, label: 'Export SDF (Pareto)', onClick: onExportSDFPareto },
    { icon: <Download size={14} />, label: 'Export SDF (all)', onClick: onExportSDF },
    { icon: <Download size={14} />, label: 'Export JSON', onClick: onExportJSON },
    { icon: <FileText size={14} />, label: 'Cite', onClick: onCite },
  ];

  return (
    <header className="flex items-center justify-between px-5 md:px-8 py-4 md:py-6 border-b border-[var(--border-5)] relative">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="md:hidden flex items-center justify-center w-9 h-9 text-[var(--text2)] hover:text-[var(--text-heading)] transition-colors -ml-1"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <button
          onClick={onReset}
          className="text-left hover:opacity-80 transition-opacity"
          title="Reset to start"
        >
          <h1 className="text-lg md:text-xl font-semibold tracking-tight text-[var(--text-heading)]">
            <span className="bg-gradient-to-r from-[#5F7367] to-[#7E9A89] bg-clip-text text-transparent">Pareto</span><span className="text-[var(--logo-mol)]">Mol</span>
          </h1>
          <div className="text-[11px] md:text-[13px] text-[var(--text2)] mt-0.5">
            multi-objective molecule analysis
          </div>
        </button>

      </div>

      <div className="flex items-center gap-2">
        {/* Desktop actions */}
        {moleculeCount > 0 && (
          <div className="hidden md:flex items-center gap-2">
            {/* Export dropdown */}
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen(!exportOpen)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] hover:text-[var(--text-heading)] transition-colors whitespace-nowrap"
              >
                <Download size={14} /> Export <ChevronDown size={12} className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
              </button>
              {exportOpen && (
                <div className="absolute top-full right-0 mt-1 bg-[var(--surface)] border border-[var(--border-10)] rounded-lg p-1 min-w-[140px] shadow-xl z-50">
                  {exportActions.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => { a.onClick?.(); setExportOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text)] rounded-md hover:bg-[var(--surface2)] transition-colors text-left"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={onCite}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] hover:text-[var(--text-heading)] transition-colors whitespace-nowrap"
            >
              <FileText size={14} /> Cite
            </button>
          </div>
        )}

        {/* Mobile overflow menu */}
        {moleculeCount > 0 && (
          <div className="md:hidden relative" ref={menuRef}>
            <button
              onClick={() => setOverflowOpen(!overflowOpen)}
              className="flex items-center justify-center w-9 h-9 text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] hover:text-[var(--text-heading)] transition-colors"
            >
              <MoreHorizontal size={18} />
            </button>
            {overflowOpen && (
              <div className="absolute top-full right-0 mt-1 bg-[var(--surface)] border border-[var(--border-10)] rounded-lg p-1.5 min-w-[160px] shadow-xl z-50">
                {allActions.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => { a.onClick?.(); setOverflowOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-[var(--text)] rounded-md hover:bg-[var(--surface2)] transition-colors text-left"
                  >
                    {a.icon} {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-9 h-9 text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] hover:text-[var(--text-heading)] transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Docs */}
        <button
          onClick={onDocs}
          className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] hover:text-[var(--text-heading)] transition-colors"
        >
          Docs
        </button>

        {/* Star + Feedback */}
        <a
          href="https://github.com/IlkhamFY/molparetolab"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] hover:text-[var(--text-heading)] transition-colors"
        >
          <GitHubIcon /> <span className="hidden sm:inline">Star</span>
        </a>
        <a
          href="https://github.com/IlkhamFY/molparetolab/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] hover:text-[var(--text-heading)] transition-colors"
        >
          <MessageSquare size={14} /> Feedback
        </a>
      </div>
    </header>
  );
}

