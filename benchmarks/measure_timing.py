#!/usr/bin/env python3
"""
Measure ADMET-AI Tier 2 prediction throughput on shared HF Space CPU tier.
Sends real SMILES in 500-mol batches, records wall-clock time per batch.

Usage: python measure_timing.py
"""

import json
import time
import urllib.request
import urllib.error

API = "https://ilkhamfy-admet-ai-api.hf.space/predict"
BATCH_SIZE = 500

# ── Generate 3000 unique drug-like SMILES ──
# Use a known set: approved drugs + simple structural variations
# We'll fetch from the API's own health/test endpoint first, then use
# a curated list of common drug SMILES repeated with minor variation.

SEED_SMILES = [
    "CC(=O)Oc1ccccc1C(=O)O",              # Aspirin
    "CC(O)c1ccc(CC(C)C)cc1",               # Ibuprofen
    "CC(=O)Nc1ccc(O)cc1",                   # Acetaminophen
    "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",        # Caffeine
    "CC12CCC3C(CCC4CC(=O)CCC34C)C1CCC2O",  # Testosterone
    "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O",  # Glucose
    "c1ccc2[nH]ccc2c1",                     # Indole
    "c1ccncc1",                              # Pyridine
    "CC(=O)O",                               # Acetic acid
    "c1ccc(cc1)O",                           # Phenol
    "CCO",                                   # Ethanol
    "CCCC",                                  # Butane
    "c1ccccc1",                              # Benzene
    "CC(N)Cc1ccccc1",                        # Amphetamine
    "CN(C)c1ccc(cc1)C(=O)O",               # DMABA
    "OC(=O)c1ccccc1O",                       # Salicylic acid
    "Nc1ccc(N)cc1",                          # PPD
    "O=C(O)CC(O)(CC(=O)O)C(=O)O",          # Citric acid
    "CC(=O)OC1=CC=CC=C1C(O)=O",            # Another aspirin form
    "c1ccc2c(c1)cccc2",                      # Naphthalene
    "O=C1NC(=O)c2ccccc21",                  # Isatoic anhydride
    "CC(C)Cc1ccc(cc1)C(C)C(=O)O",          # Ibuprofen variant
    "c1ccc(-c2ccccc2)cc1",                  # Biphenyl
    "CC1=CC(=O)c2ccccc2C1=O",              # Menadione
    "OC(=O)c1cc(O)c(O)c(O)c1",             # Gallic acid
    "Oc1ccc(cc1)C(=O)c1ccc(O)cc1",         # 4,4-dihydroxybenzophenone
    "CC(=O)Oc1ccc(cc1)C(C)=O",             # Tylenol variant
    "c1cc(ccc1N)S(=O)(=O)N",               # Sulfanilamide
    "Clc1ccc(cc1)C(c1ccc(Cl)cc1)C(Cl)(Cl)Cl",  # DDT
    "O=C(O)/C=C/c1ccccc1",                 # Cinnamic acid
    "CC1(C)C2CCC1(C)C(=O)C2",              # Camphor
    "OC(=O)c1cccnc1",                       # Nicotinic acid
    "Nc1ncnc2[nH]cnc12",                    # Adenine
    "O=c1[nH]c(=O)c2[nH]cnc2[nH]1",       # Uric acid
    "CC(=O)c1ccccc1",                        # Acetophenone
    "OC(=O)c1ccccc1N",                       # Anthranilic acid
    "c1cnc2ccccc2n1",                        # Quinoxaline
    "c1ccoc1",                               # Furan
    "c1ccsc1",                               # Thiophene
    "C1CCCCC1",                              # Cyclohexane
    "CC(=O)N(C)C",                           # DMA
    "OC(=O)C=C",                             # Acrylic acid
    "CC=CC=O",                               # Crotonaldehyde
    "c1ccc(cc1)C#N",                         # Benzonitrile
    "c1ccc(cc1)N(=O)=O",                    # Nitrobenzene
    "c1ccc(cc1)Cl",                          # Chlorobenzene
    "c1ccc(cc1)F",                           # Fluorobenzene
    "c1ccc(cc1)Br",                          # Bromobenzene
    "c1ccc(cc1)I",                           # Iodobenzene
    "c1ccc(cc1)C",                           # Toluene
    "OC(=O)CCc1ccccc1",                     # Hydrocinnamic acid
    "CC(C)(C)c1ccc(O)cc1",                  # 4-tert-Butylphenol
    "Oc1cc(O)c2c(c1)oc(-c1ccc(O)c(O)c1)c(O)c2=O",  # Quercetin
    "COc1cc(/C=C/C(=O)CC(=O)/C=C/c2ccc(O)c(OC)c2)ccc1O",  # Curcumin
    "OC[C@@H](O)[C@@H](O)[C@H](O)[C@@H](O)CO",  # Sorbitol
    "CC(=O)OCC(=O)[C@@]1(O)CC[C@H]2[C@@H]3CCC4=CC(=O)CC[C@]4(C)[C@H]3[C@@H](O)C[C@]21C",  # Cortisone acetate
    "CN1c2ccccc2C(=NCC1=O)c1ccccc1",       # Diazepam-like
    "c1ccc(cc1)c1ccccn1",                    # 2-Phenylpyridine
    "O=C(O)c1cccc(O)c1",                    # 3-Hydroxybenzoic acid
    "CC1=C(C(=O)Nc2ccccc2)C(c2ccc(Cl)cc2)C(=O)N1",  # DHPs-like
]


def make_smiles_list(n: int) -> list[str]:
    """Create a list of n SMILES by cycling through the seed set."""
    return [SEED_SMILES[i % len(SEED_SMILES)] for i in range(n)]


def send_batch(smiles: list[str], batch_num: int) -> tuple[float, bool]:
    """Send one batch to the API. Returns (elapsed_seconds, success)."""
    payload = json.dumps({
        "smiles": smiles,
        "names": [f"mol_{i}" for i in range(len(smiles))],
    }).encode("utf-8")

    req = urllib.request.Request(
        API,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read())
            elapsed = time.time() - t0
            n_results = len(data.get("results", []))
            print(f"  Batch {batch_num}: {len(smiles)} mol → {n_results} results in {elapsed:.1f}s")
            return elapsed, True
    except Exception as e:
        elapsed = time.time() - t0
        print(f"  Batch {batch_num}: FAILED after {elapsed:.1f}s — {e}")
        return elapsed, False


def measure(n: int) -> dict:
    """Measure total time for n molecules in 500-mol batches."""
    smiles = make_smiles_list(n)
    n_batches = (n + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"\n{'='*50}")
    print(f"Measuring n={n} ({n_batches} batches of ≤{BATCH_SIZE})")
    print(f"{'='*50}")

    batch_times = []
    total_start = time.time()

    for b in range(n_batches):
        start = b * BATCH_SIZE
        end = min(start + BATCH_SIZE, n)
        batch_smiles = smiles[start:end]
        elapsed, ok = send_batch(batch_smiles, b + 1)
        if not ok:
            return {"n": n, "error": True}
        batch_times.append(elapsed)
        # Brief pause between batches (matching app behavior)
        if b < n_batches - 1:
            time.sleep(0.2)

    total = time.time() - total_start
    ms_per_mol = (total / n) * 1000

    print(f"  TOTAL: {total:.1f}s ({ms_per_mol:.0f} ms/mol)")
    print(f"  Batch times: {[f'{t:.1f}' for t in batch_times]}")

    return {
        "n": n,
        "total_s": round(total, 1),
        "ms_per_mol": round(ms_per_mol),
        "batch_times": [round(t, 1) for t in batch_times],
        "n_batches": n_batches,
    }


def main():
    print("ADMET-AI Tier 2 Timing Benchmark")
    print(f"Endpoint: {API}")
    print(f"Batch size: {BATCH_SIZE}")
    print(f"Date: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Wake up the Space first (cold start can take 30s+)
    print("\nWaking up HF Space...")
    wake_smiles = ["CCO"]
    _, ok = send_batch(wake_smiles, 0)
    if not ok:
        print("FATAL: Could not reach API. Is the Space awake?")
        return
    print("Space is warm.\n")
    time.sleep(2)

    # Measure n=2000, 2500, 3000
    targets = [2000, 2500, 3000]
    results = []
    for n in targets:
        r = measure(n)
        results.append(r)
        if r.get("error"):
            print(f"ABORTING: n={n} failed")
            break
        time.sleep(3)  # Rest between measurements

    # Summary
    print(f"\n{'='*50}")
    print("SUMMARY")
    print(f"{'='*50}")
    print(f"{'n':>6} | {'Time (s)':>10} | {'ms/mol':>8} | {'Batches':>8}")
    print("-" * 45)
    for r in results:
        if not r.get("error"):
            print(f"{r['n']:>6} | {r['total_s']:>10.1f} | {r['ms_per_mol']:>8} | {r['n_batches']:>8}")

    # Save results
    out_path = "benchmarks/timing_results.json"
    with open(out_path, "w") as f:
        json.dump({
            "date": time.strftime("%Y-%m-%d"),
            "endpoint": API,
            "batch_size": BATCH_SIZE,
            "results": results,
        }, f, indent=2)
    print(f"\nResults saved to {out_path}")


if __name__ == "__main__":
    main()
