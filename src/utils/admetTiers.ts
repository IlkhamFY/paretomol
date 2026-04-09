// src/utils/admetTiers.ts

const PERSONAL_URL_KEY = 'admetai_personal_url';
const LOCAL_DETECTED_KEY = 'admetai_local_detected';
const SHARED_URL = 'https://ilkhamfy-admet-ai-api.hf.space';
const LOCAL_URL = 'http://localhost:7860';

export type AdmetTier = 'shared' | 'personal' | 'local';

export interface TierState {
  tier: AdmetTier;
  personalUrl: string | null;
  localDetected: boolean;
}

export function getTierState(): TierState {
  try {
    const personalUrl = localStorage.getItem(PERSONAL_URL_KEY);
    const localDetected = localStorage.getItem(LOCAL_DETECTED_KEY) === 'true';
    let tier: AdmetTier = 'shared';
    if (personalUrl) tier = 'personal';
    if (localDetected) tier = 'local';
    return { tier, personalUrl, localDetected };
  } catch {
    return { tier: 'shared', personalUrl: null, localDetected: false };
  }
}

export function setPersonalSpaceUrl(url: string): void {
  try {
    localStorage.setItem(PERSONAL_URL_KEY, url.replace(/\/$/, ''));
  } catch { /* storage unavailable */ }
}

export function clearPersonalSpace(): void {
  try {
    localStorage.removeItem(PERSONAL_URL_KEY);
  } catch { /* storage unavailable */ }
}

export function setLocalDetected(detected: boolean): void {
  try {
    localStorage.setItem(LOCAL_DETECTED_KEY, String(detected));
  } catch { /* storage unavailable */ }
}

/** Returns the best available endpoint URL. Priority: local > personal > shared. */
export function getActiveEndpoint(): string {
  const { localDetected, personalUrl } = getTierState();
  if (localDetected) return LOCAL_URL;
  if (personalUrl) return personalUrl;
  return SHARED_URL;
}

/** Derives the HF Space URL from a repo ID (e.g. "username/admet-ai-api"). */
export function hfSpaceUrl(repoId: string): string {
  // "ilkham/admet-ai-api" → "https://ilkham-admet-ai-api.hf.space"
  const [user, repo] = repoId.split('/');
  return `https://${user}-${repo}.hf.space`;
}

/** Silently checks if a local ADMET-AI server is running on port 7860. */
export async function detectLocalServer(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    });
    const detected = res.ok;
    setLocalDetected(detected);
    return detected;
  } catch {
    setLocalDetected(false);
    return false;
  }
}

export interface DeployResult {
  repoId: string;   // e.g. "username/admet-ai-api"
  spaceUrl: string; // e.g. "https://username-admet-ai-api.hf.space"
}

/**
 * Duplicates the shared ADMET-AI Space to the user's HF account.
 * Requires a valid HF token with write:spaces scope.
 * Returns the new repo ID and Space URL.
 */
export async function deployPersonalSpace(hfToken: string, username: string): Promise<DeployResult> {
  const repoId = `${username}/admet-ai-api`;

  const res = await fetch('https://huggingface.co/api/spaces/ilkhamfy/admet-ai-api/duplicate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${hfToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repository: repoId, hardware: 'cpu-basic' }),
  });

  if (!res.ok && res.status !== 409) {
    const err = await res.text();
    throw new Error(`HF API error ${res.status}: ${err}`);
  }
  // 409 = space already exists — reuse it

  const spaceUrl = hfSpaceUrl(repoId);
  return { repoId, spaceUrl };
}

export type SpaceStage = 'STOPPED' | 'SLEEPING' | 'BUILDING' | 'RUNNING' | 'PAUSED' | 'RUNTIME_ERROR';

/**
 * Polls the Space runtime status until it reaches RUNNING.
 * Calls onProgress with the current stage string every 3s.
 * Resolves with the Space URL once running.
 * Rejects after 5 minutes or if signal is aborted.
 */
export async function pollSpaceStatus(
  repoId: string,
  hfToken: string,
  onProgress: (stage: SpaceStage) => void,
  signal?: AbortSignal,
): Promise<string> {
  const [user, repo] = repoId.split('/');
  const statusUrl = `https://huggingface.co/api/spaces/${user}/${repo}`;
  const deadline = Date.now() + 5 * 60 * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(statusUrl, {
        headers: { 'Authorization': `Bearer ${hfToken}` },
      });
      if (res.ok) {
        const data = await res.json() as { runtime?: { stage?: SpaceStage } };
        const stage = data?.runtime?.stage ?? 'BUILDING';
        onProgress(stage);
        if (stage === 'RUNNING') return hfSpaceUrl(repoId);
        if (stage === 'RUNTIME_ERROR') throw new Error('Space failed to start');
      }
    } catch (e) {
      // Re-throw non-transient errors (RUNTIME_ERROR, AbortError)
      if (e instanceof Error && (e.message === 'Space failed to start' || e.name === 'AbortError')) throw e;
      // Transient network error — swallow and retry after delay
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Space did not start within 5 minutes');
}
