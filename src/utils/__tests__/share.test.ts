import { describe, expect, it } from 'vitest';
import { buildShareUrl, compressPayload, moleculePayloadFromLocation, urlForView } from '../share';

describe('share urls', () => {
  it('puts molecules in the fragment and keeps the tab in the query', () => {
    const payload = compressPayload('CCO ethanol');
    const url = buildShareUrl('https://paretomol.com/app?m=old#r=nope', payload, 'table');
    expect(url).toBe(`https://paretomol.com/app?tab=table#m=${payload}`);
    expect(url.includes('?m=')).toBe(false);
    expect(moleculePayloadFromLocation('', `#m=${payload}`)).toBe('CCO ethanol');
  });

  it('still reads an old ?m= link', () => {
    const payload = compressPayload('CCO ethanol');
    expect(moleculePayloadFromLocation(`?m=${payload}`, '')).toBe('CCO ethanol');
  });

  it('moves ?m= and ?r= into the fragment and keeps #r= across tab changes', () => {
    const payload = compressPayload('CCC methanol');
    const moved = urlForView({ pathname: '/', search: `?m=${payload}&tab=pareto`, hash: '' }, 'pareto');
    expect(moved).toBe(`/#m=${payload}`);
    expect(moleculePayloadFromLocation('', moved.slice(moved.indexOf('#')))).toBe('CCC methanol');

    const review = urlForView({ pathname: '/', search: '?r=v1.abc+def$ghi', hash: '' }, 'table');
    expect(review).toBe('/?tab=table#r=v1.abc+def$ghi');

    const kept = urlForView({ pathname: '/', search: '?tab=table', hash: '#r=v1.abc+def$ghi' }, 'mpo');
    expect(kept).toBe('/?tab=mpo#r=v1.abc+def$ghi');

    const shareKept = urlForView({ pathname: '/app', search: '', hash: `#m=${payload}` }, 'radar');
    expect(shareKept).toBe(`/app?tab=radar#m=${payload}`);
  });
});
