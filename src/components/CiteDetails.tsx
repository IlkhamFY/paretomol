import { useState } from 'react';
import { BIBTEX, DOI_URL, FORMATTED_CITATION, RIS } from '../utils/citation';

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        copyText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          },
          () => setCopied(false),
        );
      }}
      className="shrink-0 px-2 py-1 text-[11px] text-[var(--text2)] hover:text-[var(--text)] border border-[var(--border-5)] rounded hover:border-[var(--accent)] transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[11px] text-[var(--text2)]">{label}</span>
        <CopyButton text={text.trim() + '\n'} />
      </div>
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words bg-[var(--surface2)] border border-[var(--border-5)] rounded-md p-2.5 text-[11px] leading-relaxed font-mono text-[var(--text)]">
        {text.trim()}
      </pre>
    </div>
  );
}

/** Formatted citation, BibTeX, RIS, and the DOI. Shared by the header panel and the docs page. */
export default function CiteDetails() {
  const prose = `${FORMATTED_CITATION} ${DOI_URL}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12.5px] leading-relaxed text-[var(--text)]">{FORMATTED_CITATION}</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <a
            href={DOI_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-[var(--accent)] hover:underline break-all"
          >
            {DOI_URL}
          </a>
          <CopyButton text={prose} />
        </div>
      </div>
      <Block label="BibTeX" text={BIBTEX} />
      <Block label="RIS" text={RIS} />
    </div>
  );
}
