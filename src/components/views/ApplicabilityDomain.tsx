import { useEffect, useState } from 'react';
import type { Molecule } from '../../utils/types';
import { loadDomainReference, assessDomain, type DomainResult } from '../../utils/applicabilityDomain';

/* Applicability domain — a quiet, honest reliability cue for the ADMET predictions.
   It is a structural-novelty + property-space proxy for the model's training domain
   (nearest-neighbour ECFP4 Tanimoto to ~150 approved oral drugs, plus how many
   physicochemical descriptors fall outside that reference's central range), not the
   exact ADMET-AI training set. Predictions for "novel" compounds are extrapolations. */

const VERDICT_LABEL: Record<DomainResult['verdict'], string> = {
  typical: 'typical',
  edge: 'edge of domain',
  novel: 'novel — extrapolation',
};

export default function ApplicabilityDomain({ molecules }: { molecules: Molecule[] }) {
  const [results, setResults] = useState<Map<string, DomainResult> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDomainReference().then(ref => {
      if (cancelled || !ref || ref.fps.length === 0) return;
      const map = new Map<string, DomainResult>();
      for (const m of molecules) map.set(m.smiles, assessDomain(m, ref));
      if (!cancelled) setResults(map);
    });
    return () => { cancelled = true; };
  }, [molecules]);

  if (!results || results.size === 0) return null;

  const counts = { typical: 0, edge: 0, novel: 0 };
  for (const r of results.values()) counts[r.verdict]++;
  const flagged = counts.edge + counts.novel;

  return (
    <div className="p-3 bg-[var(--surface)] border border-[var(--border-5)] rounded-md space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[1px] text-[var(--text2)] font-medium">Applicability domain</span>
        <span className="text-[11px] text-[var(--text2)]">
          {counts.typical} typical · {counts.edge} edge · {counts.novel} novel
        </span>
      </div>

      <p className="text-[11px] text-[var(--text2)] leading-relaxed">
        {flagged === 0
          ? 'All compounds sit within the structural and property space of approved oral drugs — the ADMET predictions are interpolations.'
          : `${flagged} of ${results.size} compound${results.size === 1 ? '' : 's'} sit outside the approved-drug reference (low structural similarity and/or extreme physicochemical properties); their ADMET predictions are extrapolations — interpret with caution.`}
      </p>

      {flagged > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {molecules.map(m => {
            const r = results.get(m.smiles);
            if (!r || r.verdict === 'typical') return null;
            return (
              <span
                key={m.smiles}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[#b45309] bg-[#b45309]/12"
                title={`Nearest approved drug: Tanimoto ${r.nn.toFixed(2)}${r.outProps.length ? ` · outside range: ${r.outProps.join(', ')}` : ''}`}
              >
                {m.name.replace(/_/g, ' ')} · {VERDICT_LABEL[r.verdict]}
              </span>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-[var(--text2)]/60 leading-snug">
        A proxy for the model domain — nearest-neighbour ECFP4 Tanimoto to ~150 approved oral drugs plus physicochemical extremity — not the exact ADMET-AI training set.
      </p>
    </div>
  );
}
