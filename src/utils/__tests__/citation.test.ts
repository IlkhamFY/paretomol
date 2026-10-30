import { describe, it, expect } from 'vitest';
import { BIBTEX, CITATION_LINE, FORMATTED_CITATION, RIS, DOI, DOI_URL } from '@paretomol/core';

describe('citation copy', () => {
  it('points at the Digital Discovery article', () => {
    for (const text of [BIBTEX, RIS, FORMATTED_CITATION, CITATION_LINE]) {
      expect(text).toContain('Digital Discovery');
      expect(text).not.toContain('\u2014');
    }
    expect(BIBTEX).toContain(DOI);
    expect(RIS).toContain(DOI);
    expect(CITATION_LINE).toContain(DOI);
    expect(RIS.trim().endsWith('ER  -')).toBe(true);
    expect(DOI_URL).toBe('https://doi.org/10.1039/d6dd00366d');
  });
});
