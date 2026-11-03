import { App } from '@modelcontextprotocol/ext-apps';

interface Objective { key: string; direction: 'min' | 'max' }
interface Row {
  id: string;
  name: string;
  smiles: string;
  props?: Record<string, number>;
  svg?: string;
  paretoRank: number | null;
  mpo: number;
  values: Record<string, number | null>;
  suggested?: boolean;
}
interface Payload {
  experimental?: boolean;
  title?: string;
  source?: string;
  note?: string;
  profile?: { ref: string };
  objectives?: Objective[];
  fallbackUrl?: string;
  fallbackError?: { code: string; message: string };
  molecules?: Row[];
}

const $ = (id: string) => document.getElementById(id)!;
const decisions = new Map<string, 'accept' | 'reject'>();
let payload: Payload | null = null;

const fmt = (v: number | null | undefined): string =>
  typeof v !== 'number' || !Number.isFinite(v) ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);

function applyTheme(theme: string | undefined) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

function counts() {
  const rows = payload?.molecules ?? [];
  let acc = 0, rej = 0;
  for (const m of rows) {
    const v = decisions.get(m.id);
    if (v === 'accept') acc++;
    else if (v === 'reject') rej++;
  }
  $('counts').textContent = `${acc} accepted, ${rej} rejected, ${rows.length - acc - rej} undecided`;
}

function render(data: Payload) {
  payload = data;
  applyTheme(app.getHostContext()?.theme);
  $('title').textContent = data.title ? `Review: ${data.title}` : 'Review';
  const objs = (data.objectives ?? []).map((o) => `${o.key} ${o.direction}`).join(', ');
  const bits = [
    data.source ? `From ${data.source}` : '',
    data.profile?.ref ? `profile ${data.profile.ref}` : '',
    objs ? `ranked on ${objs}` : '',
  ].filter(Boolean);
  $('meta').textContent = bits.join(' · ');
  const note = $('note');
  if (data.note) { note.hidden = false; note.textContent = data.note; note.dataset.testid = 'review-note'; }
  else note.hidden = true;

  const fallback = $('fallback');
  fallback.replaceChildren();
  if (data.fallbackUrl) {
    const a = document.createElement('a');
    a.href = data.fallbackUrl;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.dataset.testid = 'review-fallback';
    a.textContent = 'Open the same shortlist on paretomol.com';
    fallback.append(a);
  } else if (data.fallbackError) {
    fallback.textContent = data.fallbackError.message;
    fallback.dataset.testid = 'review-fallback-error';
  } else {
    fallback.textContent = 'No review link for this shortlist.';
  }

  const host = $('rows');
  host.replaceChildren();
  const rows = [...(data.molecules ?? [])].sort((a, b) => (a.paretoRank ?? 99) - (b.paretoRank ?? 99) || b.mpo - a.mpo);
  for (const m of rows) {
    const row = document.createElement('article');
    row.className = 'row';
    row.dataset.testid = 'review-row';
    row.dataset.name = m.name;
    row.dataset.verdict = decisions.get(m.id) ?? '';

    const struct = document.createElement('div');
    struct.className = 'struct';
    if (m.svg && m.svg.includes('<svg')) struct.innerHTML = m.svg.slice(m.svg.indexOf('<svg'));

    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = m.name;
    if (m.suggested) {
      const tag = document.createElement('span');
      tag.className = 'suggested';
      tag.textContent = 'suggested';
      name.append(tag);
    }
    const facts = document.createElement('div');
    facts.className = 'facts';
    const values = (data.objectives ?? []).map((o) => `${o.key} ${fmt(m.values?.[o.key])}`).join(' · ');
    facts.textContent = `Rank ${m.paretoRank ?? 'unranked'} · MPO ${fmt(m.mpo)}${values ? ` · ${values}` : ''}`;

    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const v of ['accept', 'reject'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle';
      btn.dataset.v = v;
      btn.textContent = v === 'accept' ? 'Accept' : 'Reject';
      btn.setAttribute('aria-label', `${v === 'accept' ? 'Accept' : 'Reject'} ${m.name}`);
      btn.setAttribute('aria-pressed', decisions.get(m.id) === v ? 'true' : 'false');
      btn.addEventListener('click', () => {
        if (decisions.get(m.id) === v) decisions.delete(m.id);
        else decisions.set(m.id, v);
        render(data);
      });
      actions.append(btn);
    }
    body.append(name, facts, actions);
    row.append(struct, body);
    host.append(row);
  }
  counts();
  $('export').toggleAttribute('disabled', !data.molecules?.length);
}

const app = new App({ name: 'ParetoMol Review', version: '0.1.0' }, {}, { autoResize: false });

app.ontoolresult = (result) => {
  const status = $('status');
  if (result.isError) {
    const text = result.content?.find((c) => c.type === 'text')?.text ?? 'The review tool failed.';
    status.textContent = text;
    return;
  }
  const data = (result.structuredContent ?? {}) as Payload;
  status.textContent = '';
  render(data);
};

app.onhostcontextchanged = (ctx) => { if (ctx.theme) applyTheme(ctx.theme); };

$('export').addEventListener('click', async () => {
  if (!payload?.molecules) return;
  const button = $('export') as HTMLButtonElement;
  button.disabled = true;
  const status = $('status');
  status.textContent = '';
  try {
    const verdicts: Record<string, 'accept' | 'reject'> = {};
    for (const [id, v] of decisions) verdicts[id] = v;
    const result = await app.callServerTool({
      name: 'export_review_decision',
      arguments: {
        molecules: payload.molecules.map((m) => ({ smiles: m.smiles, name: m.name, ...(m.props && Object.keys(m.props).length ? { props: m.props } : {}) })),
        objectives: payload.objectives,
        profile: payload.profile?.ref,
        source: payload.source,
        suggested: payload.molecules.filter((m) => m.suggested).map((m) => m.name),
        decisions: verdicts,
        rationale: ($('rationale') as HTMLTextAreaElement).value,
      },
    });
    if (result.isError) {
      status.textContent = result.content?.find((c) => c.type === 'text')?.text ?? 'Export failed.';
      return;
    }
    const json = typeof result.structuredContent?.json === 'string'
      ? result.structuredContent.json
      : result.content?.find((c) => c.type === 'text')?.text ?? '';
    const pre = $('record');
    pre.hidden = false;
    pre.textContent = json;
    const a = $('download') as HTMLAnchorElement;
    a.hidden = false;
    a.download = 'paretomol_review.json';
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.textContent = 'Download decision record';
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    button.disabled = false;
  }
});

void app.connect();
