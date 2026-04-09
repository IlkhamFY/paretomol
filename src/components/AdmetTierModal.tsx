// src/components/AdmetTierModal.tsx
import { useState, useRef, useEffect } from 'react';
import { deployPersonalSpace, pollSpaceStatus, setPersonalSpaceUrl } from '../utils/admetTiers';

interface Props {
  onClose: () => void;
  onDeployed: (url: string) => void;
}

type ModalState = 'idle' | 'deploying' | 'done' | 'error';

const STAGE_LABELS: Record<string, string> = {
  STOPPED: 'Starting Space…',
  SLEEPING: 'Waking Space…',
  BUILDING: 'Building Space… (this takes ~5 min)',
  APP_STARTING: 'Starting application… (almost ready)',
  RUNNING: 'Running.',
  PAUSED: 'Resuming Space…',
  RUNTIME_ERROR: 'Error',
};

export default function AdmetTierModal({ onClose, onDeployed }: Props) {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [state, setState] = useState<ModalState>('idle');
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [deployedUrl, setDeployedUrl] = useState('');

  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Prevent closing while a deploy is in progress
  const canClose = state !== 'deploying';

  function handleClose() {
    if (!canClose) return;
    abortRef.current?.abort();
    onClose();
  }

  async function handleDeploy() {
    if (!token.trim() || !username.trim()) return;
    setState('deploying');
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setStage('Contacting Hugging Face…');
      const { repoId } = await deployPersonalSpace(token.trim(), username.trim());
      if (!mountedRef.current) return;
      setStage('Waiting for Space to start…');
      const url = await pollSpaceStatus(repoId, token.trim(), (s) => {
        if (mountedRef.current) setStage(STAGE_LABELS[s] ?? s);
      }, controller.signal);
      if (!mountedRef.current) return;
      setPersonalSpaceUrl(url);
      setDeployedUrl(url);
      setState('done');
      onDeployed(url);
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setState('error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border-5)] rounded-xl shadow-2xl w-[400px] max-w-[92vw] p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[14px] font-semibold text-[var(--text)]">Get Unlimited Predictions</div>
            <div className="text-[11px] text-[var(--text2)] mt-0.5">Deploy your own ADMET-AI Space to Hugging Face — free, unlimited, yours.</div>
          </div>
          <button onClick={handleClose} aria-label="Close" disabled={!canClose} className="text-[var(--text2)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed text-[18px] leading-none ml-3">×</button>
        </div>

        {state === 'idle' || state === 'error' ? (
          <>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] text-[var(--text2)] uppercase tracking-wider font-medium">Hugging Face Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleDeploy()}
                  placeholder="your-hf-username"
                  className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border-10)] rounded-lg text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-[var(--text2)] uppercase tracking-wider font-medium">Hugging Face Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleDeploy()}
                  placeholder="hf_..."
                  className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border-10)] rounded-lg text-[12px] font-mono text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <p className="text-[10px] text-[var(--text2)] leading-relaxed">
                Create a token with <code className="text-[var(--text)]">write</code> scope at{' '}
                <a href="https://hf.co/settings/tokens" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">hf.co/settings/tokens</a>.
                Token is used once and not stored.
              </p>
            </div>
            {error && (
              <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded text-[11px] text-[#ef4444]">
                {error}
              </div>
            )}
            <button
              onClick={handleDeploy}
              disabled={!token.trim() || !username.trim()}
              className="w-full py-2 bg-[#5F7367] hover:bg-[#6d8475] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-medium rounded-lg transition-colors"
            >
              Deploy My Space
            </button>
          </>
        ) : state === 'deploying' ? (
          <div className="space-y-3 text-center py-4">
            <div className="text-[13px] font-medium text-[var(--text)]">{stage}</div>
            <div className="text-[11px] text-[var(--text2)]">One-time setup. Your Space will stay warm after this.</div>
            <div className="w-full bg-[var(--border-5)] rounded-full h-1 overflow-hidden">
              <div className="h-1 bg-[var(--accent)] rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-center py-2">
            <div className="text-[13px] font-medium text-[var(--text)]">Your Space is live</div>
            <code className="block text-[10px] text-[var(--text2)] bg-[var(--surface)] rounded p-2 break-all">
              {deployedUrl}
            </code>
            <div className="text-[11px] text-[var(--text2)]">ParetoMol is now using your personal Space for all ADMET predictions.</div>
            <button
              onClick={onClose}
              className="w-full py-2 bg-[#5F7367] hover:bg-[#6d8475] text-white text-[12px] font-medium rounded-lg"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
