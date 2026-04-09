import { useState, useEffect } from 'react';
import type { FDADrug } from '../utils/fda_reference';

/** Lazily load the FDA reference dataset when `enabled` is true. */
export function useFDAReference(enabled: boolean): FDADrug[] | null {
  const [data, setData] = useState<FDADrug[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (data) return; // already loaded
    import('../data/fda_oral_drugs.json').then((mod) => {
      setData(mod.default as FDADrug[]);
    });
  }, [enabled]);

  return enabled ? data : null;
}
