// Test Murcko scaffold extraction using RDKit WASM
// Run: node tests/test_scaffold.mjs

// Tests for molblock parsing + iterative pruning logic (no RDKit WASM needed)

console.log('=== Scaffold Molblock Parsing Test ===\n');

// Simulated V2000 molblock for benzene (6 atoms, 6 bonds, all ring)
const benzeneMolblock = [
  '',
  '     RDKit          2D',
  '',
  '  6  6  0  0  0  0  0  0  0  0999 V2000',
  '    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    0.7500    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -0.7500    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -0.7500   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    0.7500   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  2  0',
  '  2  3  1  0',
  '  3  4  2  0',
  '  4  5  1  0',
  '  5  6  2  0',
  '  6  1  1  0',
  'M  END',
  '',
].join('\n');

function parseMolblock(molblock) {
  const lines = molblock.split('\n');
  const countsLine = lines[3];
  const nAtoms = parseInt(countsLine.substring(0, 3).trim());
  const nBonds = parseInt(countsLine.substring(3, 6).trim());
  const bondStart = 4 + nAtoms;
  
  const adj = Array.from({ length: nAtoms }, () => new Set());
  for (let b = 0; b < nBonds; b++) {
    const bline = lines[bondStart + b];
    const a1 = parseInt(bline.substring(0, 3).trim()) - 1;
    const a2 = parseInt(bline.substring(3, 6).trim()) - 1;
    adj[a1].add(a2);
    adj[a2].add(a1);
  }
  
  return { nAtoms, nBonds, adj, lines, bondStart, countsLine };
}

// Test 1: Parse benzene
const parsed = parseMolblock(benzeneMolblock);
console.log(`Benzene: ${parsed.nAtoms} atoms, ${parsed.nBonds} bonds`);
console.assert(parsed.nAtoms === 6, 'Expected 6 atoms');
console.assert(parsed.nBonds === 6, 'Expected 6 bonds');

// Test adjacency
for (let i = 0; i < 6; i++) {
  console.assert(parsed.adj[i].size === 2, `Atom ${i} should have degree 2, got ${parsed.adj[i].size}`);
}
console.log('✓ Benzene adjacency correct\n');

// Test 2: Simulate toluene (benzene + CH3 sidechain)
// 7 atoms: 0-5 are ring, 6 is methyl attached to atom 0
const tolueneMolblock = [
  '',
  '     RDKit          2D',
  '',
  '  7  7  0  0  0  0  0  0  0  0999 V2000',
  '    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    0.7500    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -0.7500    1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '   -0.7500   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    0.7500   -1.2990    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    2.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  2  0',
  '  2  3  1  0',
  '  3  4  2  0',
  '  4  5  1  0',
  '  5  6  2  0',
  '  6  1  1  0',
  '  1  7  1  0',
  'M  END',
  '',
].join('\n');

const tol = parseMolblock(tolueneMolblock);
console.log(`Toluene: ${tol.nAtoms} atoms, ${tol.nBonds} bonds`);

// Simulate ring atoms (0-5 are ring, 6 is side chain)
const ringAtoms = new Set([0, 1, 2, 3, 4, 5]);

// Iterative pruning: remove degree-1 non-ring atoms
const alive = new Set();
for (let a = 0; a < tol.nAtoms; a++) alive.add(a);

let changed = true;
while (changed) {
  changed = false;
  for (const a of alive) {
    if (ringAtoms.has(a)) continue;
    let deg = 0;
    for (const nb of tol.adj[a]) {
      if (alive.has(nb)) deg++;
    }
    if (deg <= 1) {
      alive.delete(a);
      changed = true;
    }
  }
}

console.log(`After pruning: ${alive.size} atoms remain`);
console.assert(alive.size === 6, `Expected 6 scaffold atoms, got ${alive.size}`);
console.assert(!alive.has(6), 'Methyl (atom 6) should be pruned');
console.log('✓ Toluene → benzene scaffold (methyl pruned)\n');

// Test 3: biphenyl with methyl side chains
// Atoms 0-5: ring1, 6-11: ring2, 12: CH3 on ring1, 13: CH3 on ring2
// Bond 5-6 is the inter-ring bond (linker is direct bond, no linker atoms)
const adj3 = Array.from({ length: 14 }, () => new Set());
// Ring 1: 0-1-2-3-4-5-0
[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]].forEach(([a,b]) => { adj3[a].add(b); adj3[b].add(a); });
// Ring 2: 6-7-8-9-10-11-6
[[6,7],[7,8],[8,9],[9,10],[10,11],[11,6]].forEach(([a,b]) => { adj3[a].add(b); adj3[b].add(a); });
// Inter-ring: 5-6
adj3[5].add(6); adj3[6].add(5);
// Side chains: 0-12, 8-13
adj3[0].add(12); adj3[12].add(0);
adj3[8].add(13); adj3[13].add(8);

const ringAtoms3 = new Set([0,1,2,3,4,5,6,7,8,9,10,11]);
const alive3 = new Set(Array.from({length: 14}, (_, i) => i));
changed = true;
while (changed) {
  changed = false;
  for (const a of alive3) {
    if (ringAtoms3.has(a)) continue;
    let deg = 0;
    for (const nb of adj3[a]) {
      if (alive3.has(nb)) deg++;
    }
    if (deg <= 1) {
      alive3.delete(a);
      changed = true;
    }
  }
}

console.log(`Biphenyl+2CH3: ${alive3.size} atoms remain after pruning`);
console.assert(alive3.size === 12, `Expected 12 scaffold atoms (both rings), got ${alive3.size}`);
console.assert(!alive3.has(12), 'Side chain 12 should be pruned');
console.assert(!alive3.has(13), 'Side chain 13 should be pruned');
console.log('✓ Biphenyl+2CH3 → biphenyl scaffold (both methyls pruned)\n');

// Test 4: two rings connected by a linker chain (ring-CH2-CH2-ring)
// Atoms 0-5: ring1, 6-11: ring2, 12: linker CH2, 13: linker CH2, 14: side chain on ring1
const adj4 = Array.from({ length: 15 }, () => new Set());
[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]].forEach(([a,b]) => { adj4[a].add(b); adj4[b].add(a); });
[[6,7],[7,8],[8,9],[9,10],[10,11],[11,6]].forEach(([a,b]) => { adj4[a].add(b); adj4[b].add(a); });
// Linker: 3-12-13-6
[[3,12],[12,13],[13,6]].forEach(([a,b]) => { adj4[a].add(b); adj4[b].add(a); });
// Side chain: 0-14
adj4[0].add(14); adj4[14].add(0);

const ringAtoms4 = new Set([0,1,2,3,4,5,6,7,8,9,10,11]);
const alive4 = new Set(Array.from({length: 15}, (_, i) => i));
changed = true;
while (changed) {
  changed = false;
  for (const a of alive4) {
    if (ringAtoms4.has(a)) continue;
    let deg = 0;
    for (const nb of adj4[a]) {
      if (alive4.has(nb)) deg++;
    }
    if (deg <= 1) {
      alive4.delete(a);
      changed = true;
    }
  }
}

console.log(`Ring-CH2-CH2-Ring+sidechain: ${alive4.size} atoms remain`);
console.assert(alive4.size === 14, `Expected 14 (12 ring + 2 linker), got ${alive4.size}`);
console.assert(alive4.has(12), 'Linker atom 12 should survive');
console.assert(alive4.has(13), 'Linker atom 13 should survive');
console.assert(!alive4.has(14), 'Side chain atom 14 should be pruned');
console.log('✓ Ring-CH2-CH2-Ring → scaffold keeps linker atoms, prunes side chain\n');

console.log('=== All scaffold parsing tests passed ===');
