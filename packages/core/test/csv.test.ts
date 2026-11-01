import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectCSV, parseCSVData, parseDelimited, readTable } from '../src/index';

const fixture = fileURLToPath(new URL('./fixtures/quoted-commas.csv', import.meta.url));

describe('quoted CSV', () => {
  it('keeps commas and doubled quotes inside fields', () => {
    const table = parseDelimited('smiles,name,potency\n"CCO","ethanol, absolute",5\n"CCN","say ""hi""",8\n', ',');
    expect(table).toEqual([
      ['smiles', 'name', 'potency'],
      ['CCO', 'ethanol, absolute', '5'],
      ['CCN', 'say "hi"', '8'],
    ]);
  });

  it('parses a quoted name into one column and one property', () => {
    const csv = detectCSV('smiles,name,potency\n"CCO","ethanol, absolute",5.5\nCCN,ethylamine,8\n');
    expect(csv).not.toBeNull();
    const parsed = parseCSVData(csv!);
    expect(parsed.smilesLines).toEqual(['CCO ethanol, absolute', 'CCN ethylamine']);
    expect(parsed.customPropNames).toEqual(['potency']);
    expect(parsed.customPropValues).toEqual([{ potency: 5.5 }, { potency: 8 }]);
  });

  it('still splits an unquoted table', () => {
    const csv = detectCSV('smiles,name,pIC50\nCCO,a,5\nCCCO,b,6\n');
    expect(csv?.rows).toEqual([['CCO', 'a', '5'], ['CCCO', 'b', '6']]);
  });

  it('reads the quoted-comma fixture without shifting columns', () => {
    const csv = readFileSync(fixture, 'utf8');
    const table = readTable(csv)!;
    expect(table.separator).toBe(',');
    expect(table.rows.map((r) => r[1])).toEqual([
      'name',
      'ethanol, absolute',
      'acetic, acid',
      'say "hi"',
      'CEFPROZIL ANHYDROUS, (E)-',
    ]);
    const parsed = detectCSV(csv)!;
    expect(parsed.rows[0]).toEqual(['CCO', 'ethanol, absolute', '5.5']);
    expect(parseCSVData(parsed).customPropValues[0]).toEqual({ pIC50: 5.5 });
  });

  it('parses quoted line breaks, CRLF, and tabs', () => {
    expect(parseDelimited('smiles,note\r\nCCO,"line\r\nbreak"\r\n', ',')).toEqual([
      ['smiles', 'note'],
      ['CCO', 'line\r\nbreak'],
    ]);
    const tsv = readTable('smiles\tname\tpIC50\nCCO\t"a, b"\t7\n')!;
    expect(tsv.separator).toBe('\t');
    expect(tsv.rows[1]).toEqual(['CCO', 'a, b', '7']);
  });

  it('leaves plain SMILES lines as not-a-table', () => {
    expect(readTable('CCO ethanol\nCCC methanol\n')).toBeNull();
  });
});
