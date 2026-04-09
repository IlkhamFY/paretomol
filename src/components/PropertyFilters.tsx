import { useMemo, useCallback, useRef } from 'react';
import type { Molecule, ParetoObjective } from '../utils/types';

interface PropertyFiltersProps {
  molecules: Molecule[];
  paretoObjectives: ParetoObjective[];
  propertyFilters: Record<string, { min: number; max: number }>;
  onFiltersChange: (filters: Record<string, { min: number; max: number }>) => void;
}

interface PropertyRange {
  key: string;
  dataMin: number;
  dataMax: number;
  currentMin: number;
  currentMax: number;
  histogram: number[]; // 20 buckets
}

function getMolValue(mol: Molecule, key: string): number | undefined {
  const raw = mol.props[key as keyof typeof mol.props] ?? mol.customProps[key];
  return typeof raw === 'number' ? raw : undefined;
}

function buildHistogram(values: number[], dataMin: number, dataMax: number, bins = 20): number[] {
  const counts = new Array<number>(bins).fill(0);
  const range = dataMax - dataMin;
  if (range === 0) { counts[Math.floor(bins / 2)] = values.length; return counts; }
  for (const v of values) {
    const bin = Math.min(bins - 1, Math.floor(((v - dataMin) / range) * bins));
    counts[bin]++;
  }
  return counts;
}

// ─── Dual-thumb Range Slider ──────────────────────────────────────────────────
function DualRangeSlider({
  dataMin,
  dataMax,
  currentMin,
  currentMax,
  onChange,
}: {
  dataMin: number;
  dataMax: number;
  currentMin: number;
  currentMax: number;
  onChange: (min: number, max: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const toPercent = (v: number) =>
    dataMax === dataMin ? 0 : ((v - dataMin) / (dataMax - dataMin)) * 100;

  const fromPercent = useCallback(
    (pct: number) => {
      const clamped = Math.max(0, Math.min(100, pct));
      return dataMin + (clamped / 100) * (dataMax - dataMin);
    },
    [dataMin, dataMax]
  );

  // Track mouse drag on thumb
  const startDrag = useCallback(
    (which: 'min' | 'max') => (e: React.MouseEvent) => {
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;

      const move = (ev: MouseEvent) => {
        const rect = track.getBoundingClientRect();
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        const val = fromPercent(pct);
        if (which === 'min') {
          onChange(Math.min(val, currentMax), currentMax);
        } else {
          onChange(currentMin, Math.max(val, currentMin));
        }
      };

      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };

      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [fromPercent, currentMin, currentMax, onChange]
  );

  const leftPct = toPercent(currentMin);
  const rightPct = toPercent(currentMax);

  return (
    <div ref={trackRef} className="relative h-4 flex items-center select-none" style={{ cursor: 'default' }}>
      {/* Track background */}
      <div className="absolute inset-x-0 h-[3px] bg-[var(--border-10)] rounded-full" />
      {/* Active range */}
      <div
        className="absolute h-[3px] bg-[#5F7367] rounded-full"
        style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
      />
      {/* Min thumb */}
      <div
        className="absolute w-3.5 h-3.5 rounded-full bg-[#5F7367] border-2 border-[var(--bg)] shadow-sm cursor-ew-resize z-10 -translate-x-1/2 hover:scale-110 transition-transform"
        style={{ left: `${leftPct}%` }}
        onMouseDown={startDrag('min')}
      />
      {/* Max thumb */}
      <div
        className="absolute w-3.5 h-3.5 rounded-full bg-[#5F7367] border-2 border-[var(--bg)] shadow-sm cursor-ew-resize z-10 -translate-x-1/2 hover:scale-110 transition-transform"
        style={{ left: `${rightPct}%` }}
        onMouseDown={startDrag('max')}
      />
    </div>
  );
}

// ─── Mini Histogram ───────────────────────────────────────────────────────────
function MiniHistogram({
  bins,
  currentMin,
  currentMax,
  dataMin,
  dataMax,
}: {
  bins: number[];
  currentMin: number;
  currentMax: number;
  dataMin: number;
  dataMax: number;
}) {
  const maxCount = Math.max(...bins, 1);
  const range = dataMax - dataMin;

  return (
    <div className="flex items-end gap-px h-8">
      {bins.map((count, i) => {
        const binMin = dataMin + (i / bins.length) * range;
        const binMax = dataMin + ((i + 1) / bins.length) * range;
        const inRange = binMax >= currentMin && binMin <= currentMax;
        const height = Math.max(2, (count / maxCount) * 100);
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm transition-colors ${
              inRange ? 'bg-[#5F7367]/70' : 'bg-[var(--border-10)]'
            }`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

// ─── Single Property Filter Row ───────────────────────────────────────────────
function PropertyFilterRow({
  prop,
  onChange,
}: {
  prop: PropertyRange;
  onChange: (key: string, min: number, max: number) => void;
}) {
  const fmt = (v: number) => {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Number.isInteger(v)) return v.toFixed(0);
    return v.toFixed(2);
  };

  const handleChange = useCallback(
    (min: number, max: number) => onChange(prop.key, min, max),
    [prop.key, onChange]
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--text)] font-medium">{prop.key}</span>
        <span className="text-[var(--text2)] font-mono text-[10px]">
          {fmt(prop.currentMin)} — {fmt(prop.currentMax)}
        </span>
      </div>
      <MiniHistogram
        bins={prop.histogram}
        currentMin={prop.currentMin}
        currentMax={prop.currentMax}
        dataMin={prop.dataMin}
        dataMax={prop.dataMax}
      />
      <DualRangeSlider
        dataMin={prop.dataMin}
        dataMax={prop.dataMax}
        currentMin={prop.currentMin}
        currentMax={prop.currentMax}
        onChange={handleChange}
      />
      <div className="flex justify-between text-[9px] text-[var(--text2)]/60 font-mono">
        <span>{fmt(prop.dataMin)}</span>
        <span>{fmt(prop.dataMax)}</span>
      </div>
    </div>
  );
}

// ─── Main PropertyFilters Component ──────────────────────────────────────────
export default function PropertyFilters({
  molecules,
  paretoObjectives,
  propertyFilters,
  onFiltersChange,
}: PropertyFiltersProps) {

  // Build per-property ranges from molecules + current filter state
  const propertyRanges = useMemo<PropertyRange[]>(() => {
    return paretoObjectives.map(({ key }) => {
      const values: number[] = [];
      for (const mol of molecules) {
        const v = getMolValue(mol, key);
        if (v !== undefined && isFinite(v)) values.push(v);
      }
      if (values.length === 0) return null;

      const dataMin = Math.min(...values);
      const dataMax = Math.max(...values);
      const existing = propertyFilters[key];
      const currentMin = existing?.min ?? dataMin;
      const currentMax = existing?.max ?? dataMax;

      return {
        key,
        dataMin,
        dataMax,
        currentMin: Math.max(dataMin, currentMin),
        currentMax: Math.min(dataMax, currentMax),
        histogram: buildHistogram(values, dataMin, dataMax),
      };
    }).filter((r): r is PropertyRange => r !== null);
  }, [molecules, paretoObjectives, propertyFilters]);

  const handleChange = useCallback(
    (key: string, min: number, max: number) => {
      onFiltersChange({ ...propertyFilters, [key]: { min, max } });
    },
    [propertyFilters, onFiltersChange]
  );

  const handleReset = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  // Count active filters (ones not at their data extremes)
  const activeCount = useMemo(() => {
    return propertyRanges.filter(({ key, dataMin, dataMax, currentMin, currentMax }) => {
      const eps = (dataMax - dataMin) * 0.001;
      return (
        propertyFilters[key] !== undefined &&
        (currentMin > dataMin + eps || currentMax < dataMax - eps)
      );
    }).length;
  }, [propertyRanges, propertyFilters]);

  if (propertyRanges.length === 0) return null;

  return (
    <details className="mt-4 group">
      <summary className="text-[11px] uppercase tracking-[1.2px] text-[var(--text2)] font-semibold cursor-pointer select-none hover:text-[var(--text)] transition-colors list-none flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          Range Filters
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-[#5F7367]/20 text-[#9db8a5] border border-[#5F7367]/30 text-[10px] normal-case tracking-normal">
              {activeCount} active
            </span>
          )}
        </span>
        <span className="text-[10px] text-[var(--text2)] font-normal normal-case tracking-normal opacity-50 group-open:hidden">expand</span>
        <span className="text-[10px] text-[var(--text2)] font-normal normal-case tracking-normal opacity-50 hidden group-open:inline">collapse</span>
      </summary>

      <div className="p-3 mt-2 bg-[var(--bg)] border border-[var(--border-5)] rounded-md space-y-4">
        {propertyRanges.map((prop) => (
          <PropertyFilterRow key={prop.key} prop={prop} onChange={handleChange} />
          ))}
          <div className="flex items-center justify-between pt-1 border-t border-[var(--border-5)]">
            <span className="text-[10px] text-[var(--text2)]/60">
              {activeCount > 0
                ? `${activeCount} filter${activeCount > 1 ? 's' : ''} active`
                : 'No filters active'}
            </span>
            {activeCount > 0 && (
              <button
                onClick={handleReset}
                className="text-[10px] text-[var(--text2)] hover:text-[var(--red)] transition-colors px-2 py-0.5 rounded border border-[var(--border-5)] hover:border-[var(--red)]/50"
              >
                Reset all
              </button>
            )}
          </div>
        </div>
    </details>
  );
}

// ─── Filter application helper (exported for use in App.tsx) ─────────────────
export function applyPropertyFilters(
  molecules: Molecule[],
  propertyFilters: Record<string, { min: number; max: number }>
): Molecule[] {
  const keys = Object.keys(propertyFilters);
  if (keys.length === 0) return molecules;

  return molecules.filter((mol) => {
    for (const key of keys) {
      const v = getMolValue(mol, key);
      if (v === undefined) continue; // don't exclude if property missing
      const { min, max } = propertyFilters[key];
      if (v < min || v > max) return false;
    }
    return true;
  });
}
