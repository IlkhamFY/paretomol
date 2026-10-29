import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHARED = 'https://ilkhamfy-admet-ai-api.hf.space';

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  });
  return store;
}

async function loadWarmup(): Promise<() => void> {
  vi.resetModules();
  const mod = await import('../admetAI');
  return mod.warmupAdmetEndpoint;
}

describe('warmupAdmetEndpoint', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installStorage();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sends one GET /health to the shared space and no molecule data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const warmup = await loadWarmup();

    warmup();
    warmup();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SHARED}/health`);
    expect(init.method).toBe('GET');
    expect(init.body ?? null).toBeNull();
    expect(init.cache).toBe('no-store');
    expect(init.headers).toBeUndefined();
    expect(url).not.toMatch(/smiles/i);
    expect(JSON.stringify(init)).not.toMatch(/smiles/i);
  });

  it('follows a manual endpoint override, including a trailing slash', async () => {
    store.set('admetai_endpoint', 'https://override.example/admet/');
    store.set('admetai_local_detected', 'true');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const warmup = await loadWarmup();

    warmup();

    expect(fetchMock.mock.calls[0][0]).toBe('https://override.example/admet/health');
  });

  it('prefers a detected local server over a personal space', async () => {
    store.set('admetai_personal_url', 'https://user-admet-ai-api.hf.space');
    store.set('admetai_local_detected', 'true');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const warmup = await loadWarmup();

    warmup();

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:7860/health');
  });

  it('uses a personal space when no local server is detected', async () => {
    store.set('admetai_personal_url', 'https://user-admet-ai-api.hf.space');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const warmup = await loadWarmup();

    warmup();

    expect(fetchMock.mock.calls[0][0]).toBe('https://user-admet-ai-api.hf.space/health');
  });

  it('swallows a failed warm-up and does not retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Space sleeping'));
    vi.stubGlobal('fetch', fetchMock);
    const warmup = await loadWarmup();

    expect(() => warmup()).not.toThrow();
    await Promise.resolve();
    warmup();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swallows a synchronous fetch failure', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('blocked'); });
    const warmup = await loadWarmup();
    expect(() => warmup()).not.toThrow();
  });
});
