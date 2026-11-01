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
