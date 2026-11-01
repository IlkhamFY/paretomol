import { describe, it, expect } from 'vitest';
import { activityColumns, parseAssayValue, normaliseUnit, isCensored, aggregate, isConflicting, pFromNanomolar } from '@paretomol/core';

/**
 * Assay value parsing.
 *
 * Imported assay columns carry censoring and units, both of which a plain
 * Number() coercion destroys: Number('>10000') is NaN so the record silently
 * disappears, and Number('') is 0 so a blank cell enters the analysis as a real
 * measurement — the best attainable value for any minimised objective.
 */

describe('plain numeric values', () => {
  it('parses integers, decimals and scientific notation', () => {
    expect(parseAssayValue('42')).toMatchObject({ value: 42, relation: '=', unit: null });
    expect(parseAssayValue('0.5')).toMatchObject({ value: 0.5, relation: '=' });
    expect(parseAssayValue('1.2e-9')).toMatchObject({ value: 1.2e-9, relation: '=' });
    expect(parseAssayValue('-3.5')).toMatchObject({ value: -3.5, relation: '=' });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseAssayValue('  7.5  ')).toMatchObject({ value: 7.5 });
  });
});

describe('absent measurements', () => {
  it('never turns a blank cell into zero', () => {
    for (const raw of ['', '   ', undefined, null]) {
      expect(parseAssayValue(raw as string | undefined | null), String(raw)).toBeNull();
    }
  });

  it('recognises textual missing-data placeholders', () => {
    for (const raw of ['NA', 'n/a', 'NaN', 'ND', 'N.D.', 'null', 'none', '-', '.', '?']) {
      expect(parseAssayValue(raw), raw).toBeNull();
    }
  });

  it('rejects text that carries no leading number', () => {
    expect(parseAssayValue('active')).toBeNull();
    expect(parseAssayValue('see note')).toBeNull();
  });
});

describe('censored values', () => {
  it('preserves the relation instead of discarding the record', () => {
    // Number('>10000') is NaN, so this row previously vanished silently.
    expect(parseAssayValue('>10000')).toMatchObject({ value: 10000, relation: '>' });
    expect(parseAssayValue('<0.1')).toMatchObject({ value: 0.1, relation: '<' });
    expect(parseAssayValue('>=5')).toMatchObject({ value: 5, relation: '>=' });
    expect(parseAssayValue('<=5')).toMatchObject({ value: 5, relation: '<=' });
  });

  it('accepts the typographic inequality signs', () => {
    expect(parseAssayValue('≥5')).toMatchObject({ value: 5, relation: '>=' });
    expect(parseAssayValue('≤5')).toMatchObject({ value: 5, relation: '<=' });
  });

  it('flags censored values so they can be excluded from ordering', () => {
    expect(isCensored(parseAssayValue('>10000')!)).toBe(true);
    expect(isCensored(parseAssayValue('10000')!)).toBe(false);
  });
});

describe('units', () => {
  it('keeps the unit rather than failing to parse the cell', () => {
    expect(parseAssayValue('10 uM')).toMatchObject({ value: 10, unit: 'uM' });
    expect(parseAssayValue('0.5nM')).toMatchObject({ value: 0.5, unit: 'nM' });
  });

  it('normalises the micro prefix so uM, µM and μM agree', () => {
    // U+00B5 MICRO SIGN and U+03BC GREEK SMALL LETTER MU are distinct code points.
    expect(normaliseUnit('µM')).toBe('uM');
    expect(normaliseUnit('μM')).toBe('uM');
    expect(parseAssayValue('10 µM')!.unit).toBe('uM');
  });

  it('combines a relation and a unit', () => {
    expect(parseAssayValue('> 10 uM')).toMatchObject({ value: 10, relation: '>', unit: 'uM' });
  });

  it('retains the original cell for reporting', () => {
    expect(parseAssayValue('> 10 uM')!.raw).toBe('> 10 uM');
  });
});

describe('aggregating replicates', () => {
  const v = (s: string) => parseAssayValue(s)!;

  it('takes the median, which resists an order-of-magnitude outlier', () => {
    const r = aggregate([v('10'), v('12'), v('1000')]);
    expect(r!.value).toBe(12);
    expect(r!.n).toBe(3);
  });

  it('averages the middle pair for an even count', () => {
    expect(aggregate([v('10'), v('20')])!.value).toBe(15);
  });

  it('excludes censored values but reports how many', () => {
    // Averaging a bound with a measurement yields a number that means neither.
    const r = aggregate([v('10'), v('12'), v('>10000')]);
    expect(r!.value).toBe(11);
    expect(r!.censoredExcluded).toBe(1);
  });

  it('returns null when only censored values remain', () => {
    expect(aggregate([v('>10000'), v('>5000')])).toBeNull();
  });

  it('returns null for an empty input', () => {
    expect(aggregate([])).toBeNull();
  });
});

describe('detecting disagreement between replicates', () => {
  it('accepts close replicates', () => {
    expect(isConflicting([10, 11, 12])).toBe(false);
  });

  it('flags an order-of-magnitude spread', () => {
    expect(isConflicting([10, 12, 1000])).toBe(true);
  });

  it('is scale-free', () => {
    expect(isConflicting([1e-9, 1.1e-9])).toBe(false);
    expect(isConflicting([1e-9, 1e-6])).toBe(true);
  });

  it('never flags a single measurement', () => {
    expect(isConflicting([42])).toBe(false);
  });
});

describe('p-scale conversion', () => {
  it('turns 10 uM into p 5 and keeps the nM column', () => {
    expect(pFromNanomolar(10000)).toBeCloseTo(5);
    const cols = activityColumns('IC50', ['10 uM', '1 uM', '>100 uM']);
    expect(cols?.pName).toBe('pIC50');
    expect(cols?.raw[0]).toBeCloseTo(10000);
    expect(cols?.p[0]).toBeCloseTo(5);
    expect(cols?.p[1]).toBeCloseTo(6);
    expect(cols?.p[2]).toBeNull();
    expect(cols?.note).toMatch(/censored/);
  });

  it('refuses mixed units', () => {
    const cols = activityColumns('Ki (nM)', ['10', '1 uM']);
    expect(cols?.raw).toEqual([]);
    expect(cols?.note).toMatch(/mixed units/);
  });
});
