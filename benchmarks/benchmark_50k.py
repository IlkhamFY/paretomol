#!/usr/bin/env python3
"""Benchmark ParetoMol at 25k and 50k molecules."""

import json
import csv
import time
import statistics
from pathlib import Path
from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).parent
CHEMBL_CSV = SCRIPT_DIR / "chembl_50k.csv"
RESULTS_JSON = SCRIPT_DIR / "results.json"

NEW_SIZES = [25000, 50000]
REPEATS = 3


def load_smiles_pool():
    smiles = []
    with open(CHEMBL_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            smi = row.get("SMILES") or row.get("smiles")
            if smi:
                smiles.append(smi.strip())
    print(f"Loaded {len(smiles)} SMILES")
    return smiles


def make_csv_subset(smiles_pool, n):
    subset = smiles_pool[:n]
    lines = ["SMILES,Name"]
    for i, smi in enumerate(subset):
        lines.append(f"{smi},mol_{i+1}")
    return "\n".join(lines)


def benchmark_via_file_upload(page, csv_text, n):
    tmp_csv = SCRIPT_DIR / f"_tmp_bench_{n}.csv"
    tmp_csv.write_text(csv_text, encoding="utf-8")

    try:
        page.goto("https://paretomol.com", wait_until="networkidle")
        page.wait_for_timeout(2000)

        t0 = time.perf_counter()
        file_input = page.locator('input[type="file"]')
        file_input.set_input_files(str(tmp_csv))

        page.wait_for_function(
            f"""() => {{
                const text = document.body.innerText;
                const match = text.match(/(\\d+)\\s*MOLECULES?\\s*LOADED/i);
                return match && parseInt(match[1]) >= {n};
            }}""",
            timeout=600000,
        )

        t1 = time.perf_counter()
        load_time = (t1 - t0) * 1000

        metrics = page.evaluate("""() => {
            const text = document.body.innerText;
            const match = text.match(/(\\d+)\\s*MOLECULES?\\s*LOADED/i);
            return { moleculesLoaded: match ? parseInt(match[1]) : 0 };
        }""")

        return {"loadTimeMs": round(load_time, 1), "moleculesLoaded": metrics["moleculesLoaded"]}
    finally:
        tmp_csv.unlink(missing_ok=True)


def run():
    smiles_pool = load_smiles_pool()
    new_results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        print("Warming up WASM...")
        page.goto("https://paretomol.com", wait_until="networkidle")
        page.wait_for_timeout(5000)
        print("Ready.\n")

        for n in NEW_SIZES:
            csv_text = make_csv_subset(smiles_pool, n)
            times = []

            for run_idx in range(REPEATS):
                print(f"  n={n:>6}, run {run_idx+1}/{REPEATS} ... ", end="", flush=True)
                try:
                    result = benchmark_via_file_upload(page, csv_text, n)
                    t = result["loadTimeMs"]
                    loaded = result["moleculesLoaded"]
                    times.append(t)
                    print(f"{t:.0f} ms ({loaded} loaded)")
                except Exception as e:
                    print(f"FAILED: {e}")
                    times.append(-1)

            valid = [t for t in times if t > 0]
            if valid:
                entry = {
                    "n": n,
                    "mean_ms": round(statistics.mean(valid), 1),
                    "median_ms": round(statistics.median(valid), 1),
                    "min_ms": round(min(valid), 1),
                    "max_ms": round(max(valid), 1),
                    "std_ms": round(statistics.stdev(valid), 1) if len(valid) > 1 else 0.0,
                    "runs": len(valid),
                    "all_ms": [round(t, 1) for t in valid],
                }
            else:
                entry = {"n": n, "mean_ms": -1, "error": "all runs failed"}

            new_results.append(entry)
            print(f"  => n={n}: {entry.get('mean_ms', 'FAIL')} ms mean\n")

        browser.close()

    # Merge
    with open(RESULTS_JSON) as f:
        existing = json.load(f)

    existing_ns = {r["n"] for r in existing["results"]}
    for entry in new_results:
        if entry["n"] not in existing_ns:
            existing["results"].append(entry)

    existing["results"].sort(key=lambda r: r["n"])
    existing["sizes"] = sorted(set(existing["sizes"] + NEW_SIZES))
    existing["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    with open(RESULTS_JSON, "w") as f:
        json.dump(existing, f, indent=2)

    print(f"Updated {RESULTS_JSON}")
    print("\n" + "=" * 55)
    print(f"{'Molecules':>10} {'Mean (s)':>10} {'Std (ms)':>10}")
    print("-" * 55)
    for r in existing["results"]:
        if r.get("mean_ms", -1) > 0:
            print(f"{r['n']:>10} {r['mean_ms']/1000:>10.1f} {r.get('std_ms', 0):>10.0f}")
    print("=" * 55)


if __name__ == "__main__":
    run()
