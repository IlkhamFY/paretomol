/**
 * BYOK AI: Gemini, OpenAI, Anthropic. Keys in localStorage only, never sent to our server.
 */

import type { Molecule } from './types';

export type AIProvider = 'gemini' | 'openai' | 'anthropic';

const STORAGE_PREFIX = 'paretomol_ai_';
export const AI_STORAGE_KEYS: Record<AIProvider, string> = {
  gemini: STORAGE_PREFIX + 'gemini_key',
  openai: STORAGE_PREFIX + 'openai_key',
  anthropic: STORAGE_PREFIX + 'anthropic_key',
};

export function getStoredApiKey(provider: AIProvider): string {
  try {
    return localStorage.getItem(AI_STORAGE_KEYS[provider]) ?? '';
  } catch {
    return '';
  }
}

export function setStoredApiKey(provider: AIProvider, key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(AI_STORAGE_KEYS[provider], key.trim());
    } else {
      localStorage.removeItem(AI_STORAGE_KEYS[provider]);
    }
  } catch {
    // ignore
  }
}

/** Build context string about current molecules for the AI. */
export function buildMoleculeContext(molecules: Molecule[]): string {
  if (molecules.length === 0) {
    return 'The user has no molecules loaded.';
  }
  const pareto = molecules.filter((m) => m.paretoRank === 1);
  const ro5Fail = molecules.filter((m) => !m.filters.lipinski?.pass);
  let ctx = `The user has ${molecules.length} molecule(s). ${pareto.length} are Pareto-optimal. `;
  if (ro5Fail.length > 0) ctx += `${ro5Fail.length} fail Lipinski Ro5. `;
  else ctx += 'All pass Lipinski Ro5. ';
  ctx += 'Pareto ranking uses MW, LogP, HBD, HBA, TPSA, RotBonds (lower is better except where noted).\n';
  ctx += 'Molecules (name, MW, LogP, HBD, HBA, TPSA, RotBonds, Pareto rank):\n';
  molecules.slice(0, 50).forEach((m, i) => {
    const r = m.paretoRank ?? '-';
    let line = `${i + 1}. ${m.name}: MW=${m.props.MW.toFixed(0)} LogP=${m.props.LogP.toFixed(2)} HBD=${m.props.HBD} HBA=${m.props.HBA} TPSA=${m.props.TPSA.toFixed(0)} RotBonds=${m.props.RotBonds} Pareto=${r}`;
    // Include key custom properties (ADMET, pChEMBL, IC50)
    if (m.customProps) {
      const important = ['hERG', 'AMES', 'DILI', 'ClinTox', 'HIA_Hou', 'BBB_Martins', 'pChEMBL', 'IC50_nM', 'QED'];
      const extras: string[] = [];
      for (const k of important) {
        const v = m.customProps[k];
        if (v !== undefined && v !== null) {
          extras.push(`${k}=${typeof v === 'number' ? v.toFixed(3) : v}`);
        }
      }
      // Add structural alerts
      if (m.customProps['PAINS_alert']) extras.push('PAINS_alert');
      if (m.customProps['BRENK_alert']) extras.push('BRENK_alert');
      if (m.customProps['NIH_alert']) extras.push('NIH_alert');
      if (extras.length > 0) line += ` | ${extras.join(' ')}`;
    }
    ctx += line + '\n';
  });
  if (molecules.length > 50) ctx += `... and ${molecules.length - 50} more.\n`;
  return ctx;
}

const SYSTEM_PROMPT = `You are a medicinal chemistry assistant for ParetoMol, a web tool for multi-objective Pareto analysis of drug-like molecules. You help users interpret molecular properties, ADMET predictions, Pareto rankings, and drug-likeness filters.

Key concepts:
- Pareto-optimal: no other molecule dominates on ALL objectives simultaneously
- ADMET properties (if shown): hERG=cardiotoxicity risk, AMES=mutagenicity, DILI=liver injury, ClinTox=clinical trial toxicity, HIA=intestinal absorption, BBB=blood-brain barrier, QED=drug-likeness score. Values 0-1 for classification (higher = more likely positive).
- Structural alerts: PAINS (pan-assay interference), Brenk (undesirable fragments), NIH (problematic substructures)
- pChEMBL: -log10(IC50 in M), higher = more potent

Answer concisely and scientifically. When discussing safety, note that predictions are computational and require experimental validation.`;

async function callGemini(apiKey: string, userMessage: string, context: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fullPrompt = `${context}\n\nUser question: ${userMessage}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(res.status === 401 ? 'Invalid API key' : err.slice(0, 200) || res.statusText);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) throw new Error('No response from Gemini');
  return text.trim();
}

async function callOpenAI(apiKey: string, userMessage: string, context: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\nCurrent set:\n' + context },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } })?.error?.message;
    throw new Error(res.status === 401 ? 'Invalid API key' : msg || res.statusText);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (text == null) throw new Error('No response from OpenAI');
  return text.trim();
}

async function callAnthropic(apiKey: string, userMessage: string, context: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system: SYSTEM_PROMPT + '\n\nCurrent set:\n' + context,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } })?.error?.message;
    throw new Error(res.status === 401 ? 'Invalid API key' : msg || res.statusText);
  }
  const data = await res.json();
  const block = data?.content?.find((c: { type: string }) => c.type === 'text');
  const text = block?.text;
  if (text == null) throw new Error('No response from Anthropic');
  return text.trim();
}

export async function askAI(
  provider: AIProvider,
  apiKey: string,
  userMessage: string,
  molecules: Molecule[]
): Promise<string> {
  const key = apiKey.trim();
  if (!key) throw new Error('No API key set');
  const context = buildMoleculeContext(molecules);
  if (provider === 'gemini') return callGemini(key, userMessage, context);
  if (provider === 'openai') return callOpenAI(key, userMessage, context);
  if (provider === 'anthropic') return callAnthropic(key, userMessage, context);
  throw new Error('Unknown provider');
}
