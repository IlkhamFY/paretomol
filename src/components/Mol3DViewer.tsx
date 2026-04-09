import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

declare global {
  interface Window {
    $3Dmol: any;
    RDKitModule: any;
  }
}

interface Mol3DViewerProps {
  smiles: string;
  height?: number;
  className?: string;
}

/**
 * Canonicalize SMILES via RDKit.js to avoid PubChem URL encoding issues
 * with stereo notation (/\) that breaks PUG REST requests.
 */
function canonicalizeSmiles(smiles: string): string {
  if (!window.RDKitModule) return smiles;
  try {
    const mol = window.RDKitModule.get_mol(smiles);
    if (!mol || !mol.is_valid()) return smiles;
    const canonical = mol.get_smiles();
    mol.delete();
    return canonical || smiles;
  } catch {
    return smiles;
  }
}

/**
 * Try to generate a 3D conformer via RDKit.js ETKDG embedding.
 * Returns molblock string or null if it fails.
 */
function tryRDKit3D(smiles: string): string | null {
  const RDKit = window.RDKitModule;
  if (!RDKit) return null;
  try {
    const mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) { mol?.delete(); return null; }
    // set_3d_coords returns true on success
    const ok = mol.set_3d_coords();
    if (!ok) { mol.delete(); return null; }
    const molblock = mol.get_molblock();
    mol.delete();
    return molblock || null;
  } catch {
    return null;
  }
}

/**
 * Detect if an SDF/molblock is essentially flat (all z-coords near zero).
 * Returns true if the structure is 2D / planar.
 */
function isFlat(sdf: string): boolean {
  const lines = sdf.split('\n');
  // Find the counts line (line 4 in V2000 molblock, 0-indexed line 3)
  let atomCount = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const m = lines[i].match(/^\s*(\d+)\s+(\d+)\s+.*V[23]000/);
    if (m) { atomCount = parseInt(m[1]); break; }
  }
  if (atomCount === 0) return true;

  // Parse z-coordinates from atom block
  const zCoords: number[] = [];
  let atomStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/V[23]000/.test(lines[i])) { atomStart = i + 1; break; }
  }
  if (atomStart < 0) return true;

  for (let i = atomStart; i < atomStart + atomCount && i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 4) {
      zCoords.push(parseFloat(parts[2]) || 0);
    }
  }

  if (zCoords.length < 2) return true;
  const zRange = Math.max(...zCoords) - Math.min(...zCoords);
  return zRange < 0.1; // less than 0.1 Å range = flat
}

/**
 * Fetches a 3D conformer from PubChem PUG REST and renders it
 * with 3Dmol.js (loaded via CDN). Falls back to a message if
 * PubChem doesn't have a 3D conformer or 3Dmol isn't loaded.
 */
export default function Mol3DViewer({ smiles, height = 120, className = '' }: Mol3DViewerProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [is3D, setIs3D] = useState(true);

  useEffect(() => {
    if (!containerRef.current || !smiles) return;

    // Check 3Dmol availability
    if (!window.$3Dmol) {
      setStatus('error');
      setErrorMsg('3Dmol not loaded');
      return;
    }

    let cancelled = false;

    async function load() {
      setStatus('loading');
      setErrorMsg('');

      try {
        // Canonicalize to clean up SMILES for PubChem
        const canonical = canonicalizeSmiles(smiles);

        // Use POST to avoid URL encoding issues with /\ stereo notation
        const resp = await fetch(
          'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/record/SDF?record_type=3d',
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `smiles=${encodeURIComponent(canonical)}` }
        );

        if (cancelled) return;

        if (!resp.ok) {
          // PubChem has no 3D conformer — try RDKit.js ETKDG
          const rdkit3d = tryRDKit3D(canonical);
          if (rdkit3d && !cancelled) {
            setIs3D(!isFlat(rdkit3d));
            render(rdkit3d);
            return;
          }

          // Final fallback: PubChem 2D SDF
          const resp2d = await fetch(
            'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/record/SDF',
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `smiles=${encodeURIComponent(canonical)}` }
          );
          if (!resp2d.ok) {
            setStatus('error');
            setErrorMsg('Not found on PubChem');
            return;
          }
          const sdf2d = await resp2d.text();
          if (cancelled) return;
          setIs3D(false);
          render(sdf2d);
          return;
        }

        const sdf = await resp.text();
        if (cancelled) return;
        setIs3D(true);
        render(sdf);
      } catch (e: any) {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg('Network error');
      }
    }

    function render(sdfData: string) {
      if (!containerRef.current) return;

      // Clear previous viewer
      if (viewerRef.current) {
        try { viewerRef.current.clear(); } catch (_) {}
      }
      containerRef.current.innerHTML = '';

      try {
        const viewer = window.$3Dmol.createViewer(containerRef.current, {
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          antialias: true,
        });

        viewer.addModel(sdfData, 'sdf');
        viewer.setStyle({}, {
          stick: { radius: 0.12, colorscheme: 'Jmol' },
          sphere: { scale: 0.25, colorscheme: 'Jmol' },
        });
        viewer.zoomTo();
        viewer.spin('y', 1);
        viewer.render();

        viewerRef.current = viewer;
        setStatus('ready');
      } catch (e: any) {
        setStatus('error');
        setErrorMsg('Render failed');
      }
    }

    load();

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        try { viewerRef.current.clear(); } catch (_) {}
        viewerRef.current = null;
      }
    };
  }, [smiles]);

  // Update 3Dmol background when theme changes
  useEffect(() => {
    if (!viewerRef.current) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    try { viewerRef.current.setBackgroundColor(bg); viewerRef.current.render(); } catch (_) {}
  }, [theme]);

  // Handle resize
  useEffect(() => {
    if (!viewerRef.current) return;
    const obs = new ResizeObserver(() => {
      try { viewerRef.current?.resize(); viewerRef.current?.render(); } catch (_) {}
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [status]);

  return (
    <div className={`relative ${className}`} style={{ height }}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)] rounded z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-4 h-4 border-2 border-[#5F7367]/30 border-t-[#5F7367] rounded-full animate-spin" />
            <span className="text-[10px] text-[var(--text2)]">Loading 3D…</span>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)] rounded z-10">
          <span className="text-[10px] text-[var(--text2)]/60">{errorMsg || '3D unavailable'}</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full rounded"
        style={{ position: 'relative' }}
      />
      {status === 'ready' && !is3D && (
        <span className="absolute bottom-1 left-1 text-[9px] text-[var(--text2)]/50">2D layout</span>
      )}
    </div>
  );
}

