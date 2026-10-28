import { describe, expect, it } from 'vitest';
import { analyticsPath, track } from '../track';

describe('track', () => {
  it('is a no-op when GoatCounter is not running on paretomol.com', () => {
    expect(() => track('molecules/upload')).not.toThrow();
    expect(() => track('molecules/paste')).not.toThrow();
    expect(() => track('molecules/example')).not.toThrow();
    expect(() => track('molecules/chembl')).not.toThrow();
    expect(() => track('pareto')).not.toThrow();
    expect(() => track('admet/requested')).not.toThrow();
    expect(() => track('admet/succeeded')).not.toThrow();
    expect(() => track('admet/failed')).not.toThrow();
    expect(() => track('export/png')).not.toThrow();
    expect(() => track('export/svg')).not.toThrow();
    expect(() => track('export/csv')).not.toThrow();
    expect(() => track('export/sdf')).not.toThrow();
    expect(() => track('export/json')).not.toThrow();
    expect(() => track('export/md')).not.toThrow();
    expect(() => track('cite/opened')).not.toThrow();
    expect(() => track('cite/bibtex/copied')).not.toThrow();
    expect(() => track('cite/bibtex/downloaded')).not.toThrow();
    expect(() => track('cite/ris/copied')).not.toThrow();
    expect(() => track('cite/ris/downloaded')).not.toThrow();
  });

  it('does not read a molecule payload when building a page path', () => {
    expect(analyticsPath().includes('m=')).toBe(false);
  });
});
