import { useState, useEffect } from 'react';
import { X, Key, Eye, EyeOff } from 'lucide-react';
import type { Molecule } from '../utils/types';
import { type AIProvider, getStoredApiKey, setStoredApiKey, askAI } from '../utils/ai';

interface CopilotPanelProps {
  isOpen: boolean;
  onClose: () => void;
  molecules: Molecule[];
  selectedMolIdx?: number | null;
}

function buildCannedSummary(molecules: Molecule[]): string {
  if (molecules.length === 0) return 'Load some molecules first to get a summary.';
  const pareto = molecules.filter((m) => m.paretoRank === 1);
  const ro5Fail = molecules.filter((m) => !m.filters.lipinski?.pass);
  let text = `You have ${molecules.length} molecule(s). `;
  text += `${pareto.length} are Pareto-optimal (non-dominated on MW, LogP, HBD, HBA, TPSA, RotBonds). `;
  if (ro5Fail.length > 0) {
    text += `${ro5Fail.length} fail Lipinski Ro5. `;
  } else {
    text += 'All pass Lipinski Ro5. ';
  }
  if (pareto.length > 0) {
    const names = pareto.slice(0, 5).map((m) => m.name.replace(/_/g, ' ')).join(', ');
    text += `Pareto set: ${names}${pareto.length > 5 ? '...' : ''}. Use the Scoring tab to rank by profile (e.g. CNS Drug, Oral).`;
  }
  return text;
}

function buildWhyPareto(molecules: Molecule[], nameOrIndex: string): string {
  const idx = molecules.findIndex((m) => m.name.toLowerCase().includes(nameOrIndex.toLowerCase()) || String(molecules.indexOf(m)) === nameOrIndex.trim());
  const m = idx >= 0 ? molecules[idx] : null;
  if (!m) return `I couldn't find a molecule matching "${nameOrIndex}". Try using the exact name from the sidebar or its position (1-based).`;
  if (m.paretoRank !== 1) {
    return `${m.name} is not Pareto-optimal — it's dominated by at least one other molecule (better or equal on all 6 properties, strictly better on one). Check the Dominance matrix to see who dominates it.`;
  }
  const best: string[] = [];
  const keys = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'] as const;
  keys.forEach((k) => {
    const vals = molecules.map((mol) => mol.props[k]);
    if (m.props[k] === Math.min(...vals)) best.push(k);
  });
  return `${m.name} is Pareto-optimal because no other molecule in your set is strictly better on all six properties (MW, LogP, HBD, HBA, TPSA, RotBonds). It is best in the set on: ${best.length ? best.join(', ') : 'none (but no one dominates it)'}. So it sits on the Pareto front.`;
}

const PROVIDERS: { id: AIProvider; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini (free tier)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
];

export default function CopilotPanel({ isOpen, onClose, molecules, selectedMolIdx }: CopilotPanelProps) {
  const [input, setInput] = useState('');
  const [replies, setReplies] = useState<{ user: string; text: string; error?: boolean }[]>([]);
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setApiKeyInput(getStoredApiKey(provider));
  }, [provider, isOpen]);

  const storedKey = getStoredApiKey(provider);
  const hasKey = storedKey.length > 0;

  const handleSaveKey = () => {
    setStoredApiKey(provider, apiKeyInput);
  };

  const handleSubmit = async () => {
    const q = input.trim();
    if (!q) return;
    setInput('');
    const userMsg = q;

    if (hasKey) {
      setLoading(true);
      setReplies((prev) => [...prev, { user: userMsg, text: '…' }]);
      try {
        const text = await askAI(provider, storedKey, userMsg, molecules);
        setReplies((prev) => {
          const next = [...prev];
          next[next.length - 1] = { user: userMsg, text };
          return next;
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        setReplies((prev) => {
          const next = [...prev];
          next[next.length - 1] = { user: userMsg, text: `Error: ${errMsg}`, error: true };
          return next;
        });
      } finally {
        setLoading(false);
      }
      return;
    }

    const qLower = q.toLowerCase();
    let text: string;
    if (qLower.includes('summar') || qLower.includes('overview') || qLower === 'summary') {
      text = buildCannedSummary(molecules);
    } else if (qLower.includes('trade-off') || qLower.includes('tradeoff')) {
      const pareto = molecules.filter(m => m.paretoRank === 1);
      if (pareto.length < 2) {
        text = 'Not enough Pareto-optimal molecules to analyze trade-offs. Add more diverse molecules.';
      } else {
        const keys = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'] as const;
        const ranges = keys.map(k => {
          const vals = pareto.map(m => m.props[k]);
          return { key: k, min: Math.min(...vals), max: Math.max(...vals), range: Math.max(...vals) - Math.min(...vals) };
        }).sort((a, b) => b.range - a.range);
        text = `Trade-off analysis across ${pareto.length} Pareto-optimal molecules:\n\n`;
        text += ranges.map(r => `${r.key}: ${r.min.toFixed(1)} - ${r.max.toFixed(1)} (spread: ${r.range.toFixed(1)})`).join('\n');
        text += '\n\nLargest spread = biggest trade-off dimension. Use the Pareto tab to see these visually.';
      }
    } else if (qLower.includes('fail') && (qLower.includes('ro5') || qLower.includes('lipinski'))) {
      const failures = molecules.filter(m => !m.filters.lipinski?.pass);
      if (failures.length === 0) {
        text = 'All molecules pass Lipinski Ro5!';
      } else {
        text = `${failures.length} molecule(s) fail Lipinski Ro5:\n\n` + failures.map(m => {
          const v = m.filters.lipinski?.violations ?? 0;
          return `${m.name}: ${v} violation(s)`;
        }).join('\n');
      }
    } else if (qLower.includes('why') && (qLower.includes('pareto') || qLower.includes('optimal'))) {
      const name = q.replace(/why\s*(is\s*)?/i, '').replace(/\s*(pareto|optimal).*$/i, '').trim() || (molecules.length > 0 ? molecules[0].name : '');
      text = buildWhyPareto(molecules, name);
    } else {
      text = 'Add an API key in settings (BYOK — stored only in your browser) to get full AI answers. Try the suggestion buttons or:\n\n- "Summarize my set"\n- "Why is [name] Pareto-optimal?"\n- "Which molecules fail Ro5?"\n- "What are the trade-offs?"';
    }
    setReplies((prev) => [...prev, { user: userMsg, text }]);
  };

  return (
    <div
      className={`fixed top-0 right-0 w-[420px] h-screen bg-[var(--surface)] border-l border-[var(--border-5)] z-50 flex flex-col transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="px-5 py-4 border-b border-[var(--border-5)] flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-[var(--text-heading)] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#5F7367] animate-pulse" />
          AI Copilot
        </h3>
        <button
          onClick={onClose}
          className="text-[var(--text2)] hover:text-[var(--text-heading)] hover:bg-[var(--surface2)] p-1 rounded transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 p-5 overflow-y-auto custom-scrollbar space-y-4">
        {/* BYOK settings */}
        <div className="border border-[var(--border-5)] rounded-lg bg-[var(--bg)]">
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className="w-full px-3 py-2 flex items-center justify-between text-left text-[12px] text-[var(--text2)] hover:text-[var(--text)]"
          >
            <span className="flex items-center gap-2">
              <Key size={14} />
              API key (BYOK — stored in browser only)
            </span>
            <span className="text-[10px]">{settingsOpen ? '▼' : '▶'}</span>
          </button>
          {settingsOpen && (
            <div className="px-3 pb-3 pt-0 space-y-2 border-t border-[var(--border-5)]">
              <label className="block text-[11px] text-[var(--text2)]">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as AIProvider)}
                className="w-full bg-[var(--surface)] border border-[var(--border-10)] rounded px-2 py-1.5 text-[12px] text-[var(--text)]"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <label className="block text-[11px] text-[var(--text2)]">API key</label>
              <div className="flex gap-1">
                <input
                  type={keyVisible ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onBlur={handleSaveKey}
                  placeholder="Paste key — never sent to our server"
                  className="flex-1 bg-[var(--surface)] border border-[var(--border-10)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--text2)]"
                />
                <button
                  type="button"
                  onClick={() => setKeyVisible((v) => !v)}
                  className="p-1.5 text-[var(--text2)] hover:text-[var(--text)] rounded border border-[var(--border-10)]"
                  title={keyVisible ? 'Hide' : 'Show'}
                >
                  {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleSaveKey}
                className="w-full py-1.5 bg-[#5F7367] text-white text-[11px] font-medium rounded hover:bg-[var(--accent2)]"
              >
                Save key
              </button>
              {hasKey && <p className="text-[10px] text-[#22c55e]">Key saved for {PROVIDERS.find((p) => p.id === provider)?.label}</p>}
            </div>
          )}
        </div>

        <div className="text-[11px] text-[var(--text2)] text-center p-1">
          {hasKey ? 'Ask anything about your molecules.' : 'Add a key above for full AI, or try canned queries below.'}
        </div>

        {/* Suggestion buttons */}
        {replies.length === 0 && molecules.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {(() => {
              const selMol = selectedMolIdx != null ? molecules[selectedMolIdx] : null;
              const focusMol = selMol ?? (molecules.length > 0 ? molecules[0] : null);
              return [
                'Summarize my set',
                ...(focusMol ? [`Why is ${focusMol.name} Pareto-optimal?`] : []),
                'Which molecules fail Ro5?',
                'What are the trade-offs?',
              ];
            })().map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => { setInput(q); }}
                className="px-2.5 py-1.5 text-[11px] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {replies.map((r, i) => (
          <div key={i} className="space-y-1">
            <div className="text-[11px] text-[var(--accent2)] font-medium">You</div>
            <div className="text-[12px] text-[var(--text)] bg-[var(--bg)] rounded px-2 py-1.5 border border-[var(--border-5)]">{r.user}</div>
            <div className="text-[11px] text-[var(--accent2)] font-medium mt-2">Copilot</div>
            <div className={`text-[12px] bg-[var(--bg)] rounded px-2 py-1.5 border border-[var(--border-5)] whitespace-pre-wrap ${r.error ? 'text-[#ef4444] border-[#ef4444]/30' : 'text-[var(--text)]'}`}>{r.text}</div>
          </div>
        ))}
      </div>

      <div className="p-5 border-t border-[var(--border-5)]">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSubmit())}
            className="flex-1 bg-[var(--bg)] border border-[var(--border-5)] rounded-md text-[var(--text)] text-[13px] px-3.5 py-2.5 outline-none font-sans min-h-[40px] max-h-[120px] resize-none focus:border-[var(--accent)]"
            placeholder="Ask about your molecules..."
            rows={1}
          />
          <button type="button" onClick={handleSubmit} disabled={loading} className="bg-[#5F7367] text-white w-10 h-10 rounded-md flex-shrink-0 flex items-center justify-center hover:bg-[var(--accent2)] disabled:opacity-50 transition-colors">
            {loading ? '…' : '→'}
          </button>
        </div>
      </div>
    </div>
  );
}


