// Regenerate verify-claims.json: node packages/core/test/fixtures/make-verify-fixture.mjs
// 50 FDA drugs with honest claims (rounded as an agent would report them),
// then a fixed set of seeded errors. `expected` lists every flag the verifier
// must raise; anything else it raises is a false flag.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMolecule } from '@paretomol/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..');
const RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
const rows = readFileSync(join(ROOT, 'paper', 'fda_approved_1949.csv'), 'utf8').split('\n').slice(1)
  .filter((r) => r && !r.startsWith('"')).slice(0, 50);

const claims = rows.map((r, i) => {
  const [name, , smiles] = r.split(',');
  const m = analyzeMolecule(`${smiles} x`, i, RDKit, []);
  const p = m.props;
  return {
    id: name,
    smiles,
    properties: {
      MW: +p.MW.toFixed(1), cLogP: +p.LogP.toFixed(2), HBD: p.HBD, HBA: p.HBA,
      TPSA: +p.TPSA.toFixed(1), RotB: p.RotBonds, Fsp3: +p.FrCSP3.toFixed(2), QED: +p.QED.toFixed(3),
      pIC50: +(5 + (i % 7) * 0.5).toFixed(1), // not recomputable: must be reported unchecked
    },
    objectives: [
      { key: 'QED', direction: 'max' },
      { key: i % 2 ? 'pIC50' : 'IC50_nM', direction: i % 2 ? 'max' : 'min' },
      { key: 'MW', direction: 'min' },          // no universal direction: unchecked
      { key: 'hERG', direction: 'min' },
    ],
  };
});

const expected = [];
const seed = (i, kind, key, f) => { f(claims[i]); expected.push({ id: claims[i].id, kind, ...(key ? { key } : {}) }); };
seed(2, 'value_mismatch', 'MW', (c) => { c.properties.MW = +(c.properties.MW + 14).toFixed(1); });       // off by a CH2
seed(5, 'value_mismatch', 'cLogP', (c) => { c.properties.cLogP = +(-c.properties.cLogP - 1).toFixed(2); }); // sign error
seed(8, 'value_mismatch', 'HBD', (c) => { c.properties.HBD += 1; });
seed(11, 'value_mismatch', 'TPSA', (c) => { c.properties.TPSA = +(c.properties.TPSA * 1.25 + 5).toFixed(1); });
seed(14, 'value_mismatch', 'QED', (c) => { c.properties.QED = +(c.properties.QED > 0.8 ? c.properties.QED - 0.15 : c.properties.QED + 0.15).toFixed(3); });
seed(17, 'value_mismatch', 'HBA', (c) => { c.properties.HBA += 2; });
seed(20, 'value_mismatch', 'RotB', (c) => { c.properties.RotB += 3; });
seed(23, 'value_mismatch', 'Fsp3', (c) => { c.properties.Fsp3 = +(c.properties.Fsp3 > 0.5 ? c.properties.Fsp3 - 0.2 : c.properties.Fsp3 + 0.2).toFixed(2); });
seed(26, 'value_mismatch', 'MW', (c) => { c.properties.MW = +(c.properties.MW - 1.2).toFixed(1); });       // monoisotopic-style slip
seed(30, 'direction_flipped', 'IC50_nM', (c) => { c.objectives[1].direction = 'max'; });
seed(32, 'direction_flipped', 'QED', (c) => { c.objectives[0].direction = 'min'; });
seed(35, 'direction_flipped', 'hERG', (c) => { c.objectives[3].direction = 'max'; });
seed(37, 'direction_flipped', 'pIC50', (c) => { c.objectives[1].direction = 'min'; });
seed(40, 'invalid_smiles', null, (c) => { c.smiles = c.smiles.replace(/\)/, '') + '((('; });
seed(43, 'value_mismatch', 'cLogP', (c) => { c.properties.cLogP = +(c.properties.cLogP + 0.9).toFixed(2); });
seed(46, 'direction_flipped', 'SA_Score', (c) => { c.objectives.push({ key: 'SA_Score', direction: 'max' }); });
seed(48, 'value_mismatch', 'HBD', (c) => { c.properties.HBD = c.properties.HBD === 0 ? 2 : 0; });

writeFileSync(join(HERE, 'verify-claims.json'), JSON.stringify({ claims, expected }, null, 1) + '\n');
console.log(`${claims.length} claims, ${expected.length} seeded errors`);
