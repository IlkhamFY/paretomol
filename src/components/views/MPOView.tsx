import React, { useState, useMemo } from 'react';
import type { Molecule } from '../../utils/types';
import { useTheme } from '../../contexts/ThemeContext';
import { doubleSigmoidDesirability } from '../../utils/mpo';

// ─── ADMET desirability ─────────────────────────────────────────────────────

const ADMET_MPO_DEFS = [
  { key: 'hERG',    label: 'hERG safe',   invert: true  },  // d = 1 - hERG prob
  { key: 'AMES',    label: 'AMES safe',   invert: true  },  // d = 1 - AMES prob
  { key: 'DILI',    label: 'DILI safe',   invert: true  },  // d = 1 - DILI prob
  { key: 'ClinTox', label: 'ClinTox safe',invert: true  },  // d = 1 - ClinTox prob
  { key: 'QED',     label: 'QED',         invert: false },  // d = QED (higher = better)
] as const;

// ΓöÇΓöÇΓöÇ Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

interface PropDesirability {
  idealMin: number;
  idealMax: number;
  acceptMin: number;
  acceptMax: number;
}

type PropKey = 'MW' | 'LogP' | 'HBD' | 'HBA' | 'TPSA' | 'RotBonds';
type MPOProfile = Record<PropKey, PropDesirability>;
type CurveType = 'linear' | 'sigmoid';

// ΓöÇΓöÇΓöÇ Profiles ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const PROFILES: Record<string, { label: string; desc: string; profile: MPOProfile }> = {
  oral: {
    label: 'Oral Drug',
    desc: 'Lipinski Ro5-based (MW Γëñ 500, LogP Γëñ 5, HBD Γëñ 5, HBA Γëñ 10)',
    profile: {
      MW:       { idealMin: 150, idealMax: 400, acceptMin: 100, acceptMax: 500 },
      LogP:     { idealMin: 0,   idealMax: 3.5, acceptMin: -1,  acceptMax: 5   },
      HBD:      { idealMin: 0,   idealMax: 3,   acceptMin: 0,   acceptMax: 5   },
      HBA:      { idealMin: 0,   idealMax: 7,   acceptMin: 0,   acceptMax: 10  },
      TPSA:     { idealMin: 40,  idealMax: 100, acceptMin: 20,  acceptMax: 140 },
      RotBonds: { idealMin: 0,   idealMax: 5,   acceptMin: 0,   acceptMax: 10  },
    },
  },
  cns: {
    label: 'CNS Drug',
    desc: 'BBB-penetrant (MW Γëñ 400, LogP 1-4, TPSA Γëñ 90)',
    profile: {
      MW:       { idealMin: 150, idealMax: 330, acceptMin: 100, acceptMax: 400 },
      LogP:     { idealMin: 1,   idealMax: 3.5, acceptMin: 0,   acceptMax: 5   },
      HBD:      { idealMin: 0,   idealMax: 2,   acceptMin: 0,   acceptMax: 3   },
      HBA:      { idealMin: 0,   idealMax: 5,   acceptMin: 0,   acceptMax: 7   },
      TPSA:     { idealMin: 20,  idealMax: 70,  acceptMin: 0,   acceptMax: 90  },
      RotBonds: { idealMin: 0,   idealMax: 4,   acceptMin: 0,   acceptMax: 8   },
    },
  },
  leadlike: {
    label: 'Lead-like',
    desc: 'Optimization headroom (MW Γëñ 350, LogP Γëñ 3.5)',
    profile: {
      MW:       { idealMin: 120, idealMax: 280, acceptMin: 80,  acceptMax: 350 },
      LogP:     { idealMin: -1,  idealMax: 2.5, acceptMin: -2,  acceptMax: 3.5 },
      HBD:      { idealMin: 0,   idealMax: 2,   acceptMin: 0,   acceptMax: 4   },
      HBA:      { idealMin: 0,   idealMax: 5,   acceptMin: 0,   acceptMax: 8   },
      TPSA:     { idealMin: 20,  idealMax: 90,  acceptMin: 0,   acceptMax: 120 },
      RotBonds: { idealMin: 0,   idealMax: 4,   acceptMin: 0,   acceptMax: 7   },
    },
  },
  custom: {
    label: 'Custom',
    desc: 'Edit ranges below to match your target profile',
    profile: {
      MW:       { idealMin: 150, idealMax: 400, acceptMin: 100, acceptMax: 500 },
      LogP:     { idealMin: 0,   idealMax: 3.5, acceptMin: -1,  acceptMax: 5   },
      HBD:      { idealMin: 0,   idealMax: 3,   acceptMin: 0,   acceptMax: 5   },
      HBA:      { idealMin: 0,   idealMax: 7,   acceptMin: 0,   acceptMax: 10  },
      TPSA:     { idealMin: 40,  idealMax: 100, acceptMin: 20,  acceptMax: 140 },
      RotBonds: { idealMin: 0,   idealMax: 5,   acceptMin: 0,   acceptMax: 10  },
    },
  },
};

const PROP_META: Record<PropKey, { label: string; short: string; unit: string; step: number; min: number; max: number }> = {
  MW:       { label: 'Molecular Weight', short: 'MW',   unit: 'Da',  step: 10,  min: 50,  max: 1000 },
  LogP:     { label: 'LogP',             short: 'LogP', unit: '',    step: 0.5, min: -5,  max: 10   },
  HBD:      { label: 'H-Bond Donors',    short: 'HBD',  unit: '',    step: 1,   min: 0,   max: 15   },
  HBA:      { label: 'H-Bond Acceptors', short: 'HBA',  unit: '',    step: 1,   min: 0,   max: 20   },
  TPSA:     { label: 'TPSA',             short: 'TPSA', unit: 'A┬▓',  step: 5,   min: 0,   max: 250  },
  RotBonds: { label: 'Rotatable Bonds',  short: 'RB',   unit: '',    step: 1,   min: 0,   max: 20   },
};

const PROP_KEYS: PropKey[] = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'];

// ΓöÇΓöÇΓöÇ Math ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function linearDesirability(value: number, d: PropDesirability): number {
  if (value < d.acceptMin || value > d.acceptMax) return 0;
  if (value >= d.idealMin && value <= d.idealMax) return 1;
  if (value < d.idealMin) {
    const range = d.idealMin - d.acceptMin;
    return range <= 0 ? 1 : (value - d.acceptMin) / range;
  }
  const range = d.acceptMax - d.idealMax;
  return range <= 0 ? 1 : (d.acceptMax - value) / range;
}

function sigmoidDesirability(value: number, d: PropDesirability): number {
  return doubleSigmoidDesirability(value, d.acceptMin, d.idealMin, d.idealMax, d.acceptMax);
}

function desirability(value: number, d: PropDesirability, curveType: CurveType = 'linear'): number {
  return curveType === 'sigmoid' ? sigmoidDesirability(value, d) : linearDesirability(value, d);
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  // Floor at 0.01 so one bad property doesn't nuke the entire score to ~0
  const product = values.reduce((acc, v) => acc * Math.max(v, 0.01), 1);
  return Math.pow(product, 1 / values.length);
}

function dColor(d: number): string {
  if (d >= 0.8) return '#22c55e';
  if (d >= 0.5) return '#eab308';
  if (d >= 0.2) return '#f97316';
  return '#ef4444';
}

function fmtVal(val: number, key: PropKey): string {
  if (key === 'HBD' || key === 'HBA' || key === 'RotBonds') return String(Math.round(val));
  if (key === 'MW') return val.toFixed(1);
  return val.toFixed(2);
}

// ΓöÇΓöÇΓöÇ Inline SVG: desirability curve with molecule marker ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function DesirCurve({ d, value, profile, curveType = 'linear' }: { d: number; value: number; profile: PropDesirability; curveType?: CurveType }) {
  const { acceptMin, idealMin, idealMax, acceptMax } = profile;
  const totalRange = acceptMax - acceptMin;
  const pad = totalRange * 0.12;
  const lo = acceptMin - pad;
  const hi = acceptMax + pad;
  const w = 120, h = 28, py = 4, px = 4;
  const plotW = w - px * 2, plotH = h - py * 2;

  const toX = (v: number) => px + ((v - lo) / (hi - lo)) * plotW;
  const toY = (dv: number) => py + (1 - dv) * plotH;

  let pathD: string;
  let fillD: string;

  if (curveType === 'sigmoid') {
    // Sample 40+ points along the x-range for smooth sigmoid curve
    const numPoints = 50;
    const curvePoints: Array<[number, number]> = [];
    for (let i = 0; i <= numPoints; i++) {
      const xVal = lo + (hi - lo) * (i / numPoints);
      const dVal = sigmoidDesirability(xVal, profile);
      curvePoints.push([toX(xVal), toY(dVal)]);
    }
    pathD = curvePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    // Fill: close the path along the bottom
    fillD = pathD + ` L${toX(hi).toFixed(1)},${toY(0).toFixed(1)} L${toX(lo).toFixed(1)},${toY(0).toFixed(1)} Z`;
  } else {
    // Trapezoid path points
    const points = [
      [toX(lo), toY(0)],
      [toX(acceptMin), toY(0)],
      [toX(idealMin), toY(1)],
      [toX(idealMax), toY(1)],
      [toX(acceptMax), toY(0)],
      [toX(hi), toY(0)],
    ];
    pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const fillPoints = [
      [toX(acceptMin), toY(0)],
      [toX(idealMin), toY(1)],
      [toX(idealMax), toY(1)],
      [toX(acceptMax), toY(0)],
    ];
    fillD = fillPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${toX(acceptMax).toFixed(1)},${toY(0).toFixed(1)} L${toX(acceptMin).toFixed(1)},${toY(0).toFixed(1)} Z`;
  }

  // Molecule marker position
  const mx = toX(Math.max(lo, Math.min(hi, value)));
  const my = toY(d);
  const col = dColor(d);

  return (
    <svg width={w} height={h} className="block">
      {/* Fill under curve */}
      <path d={fillD} fill="rgba(34,197,94,0.08)" />
      {/* Curve line */}
      <path d={pathD} fill="none" stroke="var(--border-5)" strokeWidth="1" />
      {/* Ideal zone highlight */}
      <line x1={toX(idealMin)} y1={toY(1)} x2={toX(idealMax)} y2={toY(1)} stroke="rgba(34,197,94,0.3)" strokeWidth="2" />
      {/* Molecule marker: vertical line + dot */}
      <line x1={mx} y1={toY(0)} x2={mx} y2={my} stroke={col} strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
      <circle cx={mx} cy={my} r="3.5" fill={col} stroke="var(--bg)" strokeWidth="1" />
    </svg>
  );
}

// ΓöÇΓöÇΓöÇ Component ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function MPOView({
  molecules,
  selectedMolIdx,
  setSelectedMolIdx,
}: {
  molecules: Molecule[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
}) {
  useTheme(); // subscribe to theme changes
  const [profileName, setProfileName] = useState<keyof typeof PROFILES>('oral');
  const [customProfile, setCustomProfile] = useState<MPOProfile>({ ...PROFILES.custom.profile });
  const [showRangeEditor, setShowRangeEditor] = useState(false);
  const [sortBy, setSortBy] = useState<'mpo' | PropKey>('mpo');
  const [curveType, setCurveType] = useState<CurveType>('linear');
  const [includeAdmet, setIncludeAdmet] = useState(false);

  const admetPresent = useMemo(
    () => molecules.some(m => m.customProps && ADMET_MPO_DEFS.some(d => m.customProps![d.key] != null)),
    [molecules]
  );

  const activeProfile: MPOProfile =
    profileName === 'custom' ? customProfile : PROFILES[profileName].profile;

  const selectProfile = (name: keyof typeof PROFILES) => {
    setProfileName(name);
    if (name !== 'custom') setCustomProfile({ ...PROFILES[name].profile });
  };

  const updateBoundary = (prop: PropKey, field: keyof PropDesirability, raw: string) => {
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    setCustomProfile(prev => ({ ...prev, [prop]: { ...prev[prop], [field]: val } }));
    setProfileName('custom');
  };

  const scored = useMemo(() => {
    const items = molecules.map((mol, idx) => {
      const perProp: Record<PropKey, number> = {} as Record<PropKey, number>;
      let worstKey: PropKey = 'MW';
      let worstD = 2;
      PROP_KEYS.forEach(k => {
        const d = desirability(mol.props[k], activeProfile[k], curveType);
        perProp[k] = d;
        if (d < worstD) { worstD = d; worstKey = k; }
      });

      // ADMET desirability terms — included in geometric mean only when toggle is on
      const admetD: Record<string, number> = {};
      if (includeAdmet && mol.customProps) {
        ADMET_MPO_DEFS.forEach(({ key, invert }) => {
          const raw = mol.customProps![key];
          if (raw != null) {
            admetD[key] = invert ? 1 - (raw as number) : (raw as number);
          }
        });
      }

      const mpo = geometricMean([...Object.values(perProp), ...Object.values(admetD)]);
      return { idx, mol, perProp, admetD, mpo, worstKey, worstD };
    });

    // Sort
    if (sortBy === 'mpo') {
      items.sort((a, b) => b.mpo - a.mpo);
    } else {
      items.sort((a, b) => a.perProp[sortBy] - b.perProp[sortBy]);
    }
    return items;
  }, [molecules, activeProfile, sortBy, curveType, includeAdmet]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text-heading)]">MPO Desirability Scoring</h3>
        <p className="text-[12px] text-[var(--text2)] mt-0.5">
          Geometric mean of per-property desirability (0-1). Each property scored against an ideal range.
        </p>
      </div>

      {/* Profile selector + curve toggle + range toggle */}
      <div className="flex items-center justify-between border-b border-[var(--border-5)]">
        <div className="flex items-center gap-1">
          {Object.entries(PROFILES).map(([name, def]) => (
            <button
              key={name}
              onClick={() => selectProfile(name as keyof typeof PROFILES)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors border-b-2 ${
                profileName === name
                  ? 'border-[var(--accent)] text-[var(--text-heading)]'
                  : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'
              }`}
              title={def.desc}
            >
              {def.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pb-1">
          {/* ADMET toggle — only shown when predictions are loaded */}
          {admetPresent && (
            <button
              onClick={() => setIncludeAdmet(v => !v)}
              title="Include hERG/AMES/DILI/QED desirability in the MPO geometric mean"
              className={`px-2.5 py-1 text-[10px] font-medium rounded border transition-colors ${
                includeAdmet
                  ? 'bg-[#5F7367]/20 text-[#8fad9a] border-[#5F7367]/30'
                  : 'text-[var(--text2)] border-[var(--border-5)] hover:text-[var(--text)]'
              }`}
            >
              + ADMET
            </button>
          )}
          {/* Curve type toggle */}
          <div className="flex items-center rounded-md border border-[var(--border-5)] overflow-hidden">
            {(['linear', 'sigmoid'] as const).map(ct => (
              <button
                key={ct}
                onClick={() => setCurveType(ct)}
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  curveType === ct
                    ? 'bg-[#5F7367]/20 text-[#8fad9a]'
                    : 'text-[var(--text2)] hover:text-[var(--text)]'
                }`}
              >
                {ct === 'linear' ? 'Linear' : 'Sigmoid'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowRangeEditor(p => !p)}
            className="text-[11px] text-[var(--text2)] hover:text-[var(--text)] transition-colors flex items-center gap-1"
          >
            Ranges
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`transition-transform ${showRangeEditor ? 'rotate-180' : ''}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text2)]/70 -mt-3 italic">{PROFILES[profileName].desc}</p>

      {/* Range editor */}
      {showRangeEditor && (
        <div className="border border-[var(--border-5)] rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_repeat(4,_auto)] text-[10px] font-medium text-[var(--text2)] bg-[var(--bg)] px-3 py-2 gap-x-4">
            <span>Property</span>
            <span className="w-20 text-center">Accept min</span>
            <span className="w-20 text-center text-[#8fad9a]">Ideal min</span>
            <span className="w-20 text-center text-[#8fad9a]">Ideal max</span>
            <span className="w-20 text-center">Accept max</span>
          </div>
          {PROP_KEYS.map(key => {
            const meta = PROP_META[key];
            const vals = activeProfile[key];
            return (
              <div key={key} className="grid grid-cols-[1fr_repeat(4,_auto)] items-center px-3 py-2 gap-x-4 border-t border-[var(--border-5)]">
                <div>
                  <div className="text-[12px] text-[var(--text)]">{meta.label}</div>
                  {meta.unit && <div className="text-[10px] text-[var(--text2)]">{meta.unit}</div>}
                </div>
                {(['acceptMin', 'idealMin', 'idealMax', 'acceptMax'] as const).map(field => (
                  <input
                    key={field}
                    type="number"
                    value={vals[field]}
                    step={meta.step}
                    min={meta.min}
                    max={meta.max}
                    onChange={e => updateBoundary(key, field, e.target.value)}
                    className={`w-20 text-center text-[12px] font-mono rounded px-2 py-1 border bg-[var(--surface)] outline-none focus:border-[#5F7367]/60 transition-colors ${
                      field === 'idealMin' || field === 'idealMax'
                        ? 'border-[#5F7367]/30 text-[#8fad9a]'
                        : 'border-[var(--border-5)] text-[var(--text2)]'
                    }`}
                  />
                ))}
              </div>
            );
          })}
          <div className="flex gap-4 px-3 py-2 border-t border-[var(--border-5)] bg-[var(--bg)]">
            {[
              { color: '#22c55e', label: 'Ideal (d = 1.0)' },
              { color: '#eab308', label: curveType === 'sigmoid' ? 'Transition (sigmoid)' : 'Acceptable (linear 0-1)' },
              { color: '#ef4444', label: 'Unacceptable (d = 0)' },
            ].map(z => (
              <div key={z.label} className="flex items-center gap-1.5 text-[10px] text-[var(--text2)]">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: z.color, opacity: 0.7 }} />
                {z.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sort controls */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-[var(--text2)]">Sort by:</span>
        <button
          onClick={() => setSortBy('mpo')}
          className={`px-2 py-0.5 rounded transition-colors ${
            sortBy === 'mpo' ? 'bg-[#5F7367]/20 text-[#8fad9a]' : 'text-[var(--text2)] hover:text-[var(--text)]'
          }`}
        >
          MPO score
        </button>
        {PROP_KEYS.map(k => (
          <button
            key={k}
            onClick={() => setSortBy(k)}
            className={`px-2 py-0.5 rounded transition-colors ${
              sortBy === k ? 'bg-[#5F7367]/20 text-[#8fad9a]' : 'text-[var(--text2)] hover:text-[var(--text)]'
            }`}
          >
            {PROP_META[k].short}
          </button>
        ))}
      </div>

      {/* Scored molecule cards */}
      <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1 custom-scrollbar">
        {scored.map((r, ri) => {
          const mpoCol = dColor(r.mpo);
          const isSelected = selectedMolIdx === r.idx;

          return (
            <div
              key={r.idx}
              className={`rounded-md border transition-colors cursor-pointer ${
                isSelected
                  ? 'border-[var(--accent)] bg-[#5F7367]/10'
                  : r.mol.paretoRank === 1
                    ? 'border-[#5F7367]/20 bg-[#5F7367]/5 hover:bg-[#5F7367]/10'
                    : 'border-[var(--border-5)] bg-[var(--bg)] hover:bg-[var(--surface)]'
              }`}
              onClick={() => setSelectedMolIdx?.(isSelected ? null : r.idx)}
            >
              <div className="flex items-center gap-3 p-3">
                {/* Rank */}
                <div className="font-mono text-[11px] text-[var(--text2)] w-6 text-center shrink-0">
                  #{ri + 1}
                </div>

                {/* Name + bottleneck + mini curves */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[13px] font-medium text-[var(--text-heading)] truncate">{r.mol.name}</span>
                    {r.mol.paretoRank === 1 && (
                      <span className="shrink-0 text-[8px] font-medium text-[#22c55e] bg-[#22c55e]/10 px-1 py-0.5 rounded">P</span>
                    )}
                    {/* Bottleneck flag */}
                    {r.worstD < 0.5 && (
                      <span
                        className="text-[10px] px-1.5 py-0 rounded-full shrink-0"
                        style={{
                          color: dColor(r.worstD),
                          backgroundColor: dColor(r.worstD) + '18',
                          border: `1px solid ${dColor(r.worstD)}40`,
                        }}
                      >
                        Γåô {PROP_META[r.worstKey].short}
                      </span>
                    )}
                  </div>

                  {/* Mobile: compact property bars */}
                  <div className="flex sm:hidden gap-1 flex-wrap">
                    {PROP_KEYS.map(k => {
                      const d = r.perProp[k];
                      return (
                        <span
                          key={k}
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{ color: dColor(d), backgroundColor: dColor(d) + '15' }}
                        >
                          {PROP_META[k].short} {d.toFixed(1)}
                        </span>
                      );
                    })}
                  </div>

                  {/* Desktop: mini SVG curves */}
                  <div className="hidden sm:flex gap-0.5">
                    {PROP_KEYS.map(k => {
                      const d = r.perProp[k];
                      const isWorst = k === r.worstKey && r.worstD < 0.8;
                      return (
                        <div
                          key={k}
                          className={`flex flex-col items-center ${isWorst ? 'opacity-100' : 'opacity-70'}`}
                          title={`${PROP_META[k].label}: ${fmtVal(r.mol.props[k], k)} ΓåÆ d=${d.toFixed(2)}`}
                        >
                          <DesirCurve d={d} value={r.mol.props[k]} profile={activeProfile[k]} curveType={curveType} />
                          <span className={`text-[9px] ${isWorst ? 'text-' + (d < 0.2 ? '[#ef4444]' : '[#eab308]') : 'text-[var(--text2)]'}`} style={isWorst ? { color: dColor(d) } : undefined}>
                            {PROP_META[k].short}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* MPO score */}
                <div className="flex flex-col items-end shrink-0 ml-2">
                  <span className="text-[20px] font-bold font-mono tabular-nums leading-tight" style={{ color: mpoCol }}>
                    {r.mpo.toFixed(2)}
                  </span>
                  <div className="w-20 h-1.5 bg-[var(--border-5)] rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(r.mpo * 100, r.mpo > 0 ? 4 : 0)}%`, backgroundColor: mpoCol }}
                    />
                  </div>
                  <span className="text-[9px] text-[var(--text2)] mt-0.5">MPO</span>
                </div>
              </div>

              {/* Expanded detail */}
              {isSelected && (
                <div className="px-3 pb-3 border-t border-[var(--border-5)]">
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {PROP_KEYS.map(k => {
                      const val = r.mol.props[k] ?? 0;
                      const d = r.perProp[k];
                      const col = dColor(d);
                      const ap = activeProfile[k];
                      const isWorst = k === r.worstKey;
                      return (
                        <div
                          key={k}
                          className={`flex flex-col gap-1 p-2.5 rounded border ${
                            isWorst && r.worstD < 0.5
                              ? 'border-[#ef4444]/30 bg-[#ef4444]/5'
                              : 'border-[var(--border-5)] bg-[var(--surface)]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[var(--text2)]">{PROP_META[k].label}</span>
                            {isWorst && r.worstD < 0.5 && (
                              <span className="text-[9px] px-1 rounded" style={{ color: col, backgroundColor: col + '18' }}>bottleneck</span>
                            )}
                          </div>
                          <div className="text-[14px] font-mono font-medium text-[var(--text-heading)]">
                            {fmtVal(val, k)}
                            {PROP_META[k].unit && <span className="text-[10px] text-[var(--text2)] ml-0.5">{PROP_META[k].unit}</span>}
                          </div>
                          <DesirCurve d={d} value={val} profile={ap} />
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-[var(--text2)]/60">
                              ideal [{ap.idealMin}-{ap.idealMax}]
                            </span>
                            <span className="text-[11px] font-mono font-medium" style={{ color: col }}>
                              d = {d.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ADMET desirability panel — shown when predictions available */}
                  {Object.keys(r.admetD).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-5)]">
                      <div className="text-[10px] font-medium text-[var(--text2)] mb-2">ADMET Safety</div>
                      <div className="flex flex-wrap gap-2">
                        {ADMET_MPO_DEFS.map(({ key, label }) => {
                          const d = r.admetD[key];
                          if (d == null) return null;
                          const col = dColor(d);
                          const raw = r.mol.customProps?.[key] as number | undefined;
                          return (
                            <div
                              key={key}
                              className="flex flex-col items-center px-2 py-1 rounded border text-center"
                              style={{ borderColor: col + '40', backgroundColor: col + '10' }}
                            >
                              <span className="text-[9px] text-[var(--text2)]">{label}</span>
                              <span className="text-[13px] font-mono font-medium" style={{ color: col }}>
                                {d.toFixed(2)}
                              </span>
                              {raw != null && (
                                <span className="text-[9px] text-[var(--text2)]/70">{raw.toFixed(2)}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Distribution histogram */}
      {scored.length > 0 && (
        <div>
          <div className="text-[11px] text-[var(--text2)] mb-2 font-medium">MPO distribution</div>
          <div className="flex items-end gap-1 h-16">
            {scored.map(r => {
              const col = dColor(r.mpo);
              const isSel = selectedMolIdx === r.idx;
              return (
                <div
                  key={r.idx}
                  className="flex flex-col items-center gap-0.5 cursor-pointer flex-1 min-w-0"
                  title={`${r.mol.name}: ${r.mpo.toFixed(3)}`}
                  onClick={() => setSelectedMolIdx?.(isSel ? null : r.idx)}
                >
                  <div className="w-full flex items-end" style={{ height: '52px' }}>
                    <div
                      className={`w-full rounded-sm transition-all duration-300 ${isSel ? 'ring-1 ring-white/40' : ''}`}
                      style={{
                        height: `${Math.max(r.mpo * 100, 4)}%`,
                        backgroundColor: col,
                        opacity: isSel ? 1 : 0.7,
                      }}
                    />
                  </div>
                  <span className="text-[8px] truncate w-full text-center" style={{ color: isSel ? 'var(--text)' : 'var(--text2)' }}>
                    {r.mol.name.length > 6 ? r.mol.name.slice(0, 5) + '\u2026' : r.mol.name}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-[var(--text2)]/50 border-t border-[var(--border-5)] pt-3">
        Score = geometric mean of {includeAdmet && admetPresent ? '6 physicochemical + ADMET safety' : '6'} {curveType === 'sigmoid' ? 'sigmoid' : 'linear'} desirability functions (d floored at 0.01).
        Green &ge; 0.8 &middot; Yellow &ge; 0.5 &middot; Orange &ge; 0.2 &middot; Red &lt; 0.2.
        Bottleneck = lowest individual desirability.{!admetPresent && ' Run ADMET predictions to unlock "+ ADMET" scoring.'}
      </div>
    </div>
  );
}

export default React.memo(MPOView);


