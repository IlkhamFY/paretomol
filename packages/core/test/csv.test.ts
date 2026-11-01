import { describe, it, expect } from 'vitest';
import { detectCSV, parseCSVData, parseDelimited } from '../src/analyze';

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
});
