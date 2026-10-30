/**
 * Single source for the Digital Discovery citation.
 * Yabbarov & Vargas-Hernández, Digital Discovery, 2026, 5, 4231-4247.
 * DOI 10.1039/d6dd00366d.
 */

export const DOI = '10.1039/d6dd00366d';
export const DOI_URL = `https://doi.org/${DOI}`;
export const PREPRINT_DOI = '10.26434/chemrxiv.15002217/v1';
export const PREPRINT_URL = `https://doi.org/${PREPRINT_DOI}`;

export const PAPER_TITLE =
  'ParetoMol: a free web application for multi-objective pareto analysis of molecular safety and pharmacokinetics';

/** Prose citation, without the URL (the URL is shown as its own link). */
export const FORMATTED_CITATION =
  'Yabbarov, I.; Vargas-Hernández, R. A. ParetoMol: a free web application for multi-objective pareto analysis of molecular safety and pharmacokinetics. Digital Discovery 2026, 5 (10), 4231-4247.';

/** One line for export footers, image margins, and CSV metadata. Includes the DOI URL. */
export const CITATION_LINE =
  'Yabbarov & Vargas-Hernández, Digital Discovery 2026, 5, 4231-4247. https://doi.org/10.1039/d6dd00366d';

/** Column name for table exports that must stay header-first. */
export const CITATION_COLUMN = 'citation';

export const BIBTEX = `@article{yabbarov2026paretomol,
  author    = {Yabbarov, Ilkham and Vargas-Hernández, Rodrigo A.},
  title     = {${PAPER_TITLE}},
  journal   = {Digital Discovery},
  year      = {2026},
  volume    = {5},
  number    = {10},
  pages     = {4231--4247},
  doi       = {${DOI}},
  url       = {${DOI_URL}},
  publisher = {Royal Society of Chemistry}
}
`;

export const RIS = `TY  - JOUR
AU  - Yabbarov, Ilkham
AU  - Vargas-Hernández, Rodrigo A.
TI  - ${PAPER_TITLE}
JO  - Digital Discovery
VL  - 5
IS  - 10
SP  - 4231
EP  - 4247
PY  - 2026
DO  - ${DOI}
UR  - ${DOI_URL}
PB  - Royal Society of Chemistry
ER  -
`;

export const CITATION_META = {
  text: FORMATTED_CITATION,
  doi: DOI,
  url: DOI_URL,
} as const;

/** Leading comment for the main analysis CSV, which already uses a # line. */
export function csvCitationComment(isoTimestamp: string): string {
  return `# ParetoMol export ${isoTimestamp} | ${CITATION_LINE}\n`;
}

type CiteListener = (open: boolean) => void;
const citeListeners = new Set<CiteListener>();

/** Ask the header Cite panel to open. Used by the footer and the landing line. */
export function openCitePanel(): void {
  citeListeners.forEach((fn) => fn(true));
}

export function subscribeCitePanel(fn: CiteListener): () => void {
  citeListeners.add(fn);
  return () => {
    citeListeners.delete(fn);
  };
}
