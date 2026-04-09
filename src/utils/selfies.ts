// SELFIES-TED similarity via IBM Research HF Space (ilkhamfy/selfies-ted-api)

const TED_SPACE_URL = 'https://ilkhamfy-selfies-ted-api.hf.space/embeddings';

const TED_TOKEN_KEY = 'hf_inference_token';
export function saveTEDToken(token: string): void {
  const t = token.trim();
  try {
    if (t) localStorage.setItem(TED_TOKEN_KEY, t);
    else localStorage.removeItem(TED_TOKEN_KEY);
  } catch { /* storage unavailable */ }
}
export function getTEDToken(): string {
  try {
    return localStorage.getItem(TED_TOKEN_KEY)
      || (import.meta.env.VITE_HF_TOKEN as string | undefined)
      || '';
  } catch {
    return (import.meta.env.VITE_HF_TOKEN as string | undefined) || '';
  }
}

function cosineSimVec(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export type TEDResult =
  | { matrix: number[][] }
  | { error: string };

/**
 * Compute n×n similarity matrix using SELFIES-TED embeddings (IBM Research).
 * Calls the public ilkhamfy/selfies-ted-api HF Space — no auth required.
 */
export async function computeSelfiesTEDMatrix(
  molecules: { smiles: string }[]
): Promise<TEDResult> {
  let res: Response;
  try {
    res = await fetch(TED_SPACE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smiles: molecules.map(m => m.smiles) }),
    });
  } catch {
    return { error: 'Cannot reach SELFIES-TED Space — check your internet connection' };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: `SELFIES-TED error ${res.status}${body ? ': ' + body.slice(0, 120) : ''}` };
  }

  let data: { embeddings: number[][] };
  try {
    data = await res.json();
  } catch {
    return { error: 'Invalid response from SELFIES-TED Space' };
  }
  if (!Array.isArray(data?.embeddings) || !Array.isArray(data.embeddings[0])) {
    return { error: 'Unexpected response shape from SELFIES-TED Space' };
  }

  const { embeddings } = data;
  const n = embeddings.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimVec(embeddings[i], embeddings[j]);
      matrix[i][j] = matrix[j][i] = sim;
    }
  }
  return { matrix };
}
