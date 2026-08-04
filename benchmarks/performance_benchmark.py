#!/usr/bin/env python3
"""
ParetoMol Performance Benchmark
================================
Measures end-to-end load time (CSV parse → RDKit descriptors → Pareto ranking → render)
for increasing molecule counts. Uses Playwright to drive the real app.

Usage:
    python performance_benchmark.py [--url https://paretomol.com] [--output results.json]
"""

import json
import csv
import time
import random
import argparse
import statistics
from pathlib import Path
from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
FDA_CSV = PROJECT_DIR / "paper" / "fda_approved_1949.csv"
DELANEY_CSV = PROJECT_DIR / "paper" / "delaney-processed.csv"

# Target molecule counts for benchmarking
SIZES = [10, 25, 50, 100, 250, 500, 1000, 1949]
REPEATS = 3  # Number of runs per size for statistical robustness


def load_smiles_pool():
    """Load all SMILES from the FDA dataset."""
    smiles = []
    with open(FDA_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            smi = row.get("smiles") or row.get("SMILES") or row.get("Smiles")
            if smi:
                smiles.append(smi.strip())
    print(f"Loaded {len(smiles)} SMILES from FDA dataset")
    return smiles


def make_csv_subset(smiles_pool: list[str], n: int) -> str:
    """Create a CSV string with n molecules (SMILES + Name columns)."""
    subset = smiles_pool[:n] if n <= len(smiles_pool) else smiles_pool
    lines = ["SMILES,Name"]
    for i, smi in enumerate(subset):
        lines.append(f"{smi},mol_{i+1}")
    return "\n".join(lines)


def benchmark_load(page, csv_text: str, n: int, run_idx: int) -> dict:
    """
    Load CSV into ParetoMol and measure timings.
    Returns dict with timing breakdown.
    """
    # Navigate fresh each time to clear state
    page.goto(page.url.split("#")[0], wait_until="networkidle")
    page.wait_for_timeout(1000)  # let RDKit WASM init

    # Inject CSV via the paste/textarea approach
    # ParetoMol accepts SMILES pasted into the text area
    result = page.evaluate("""(csvText) => {
        return new Promise((resolve) => {
            const t0 = performance.now();

            // Find the paste textarea or trigger file upload
            // ParetoMol uses a drag-drop / file input approach
            // We'll use the internal loadFromText if available, or simulate paste
            const textarea = document.querySelector('textarea');
            if (textarea) {
                textarea.value = csvText;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Wait for molecules to appear in the sidebar
            const checkInterval = setInterval(() => {
                const molCards = document.querySelectorAll('[class*="molecule"]');
                const loadedText = document.body.innerText;
                const match = loadedText.match(/(\\d+)\\s*MOLECULES?\\s*LOADED/i);
                if (match && parseInt(match[1]) > 0) {
                    clearInterval(checkInterval);
                    const t1 = performance.now();
                    resolve({
                        loadTimeMs: t1 - t0,
                        moleculesLoaded: parseInt(match[1]),
                    });
                }
            }, 100);

            // Timeout after 120s
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve({ loadTimeMs: -1, moleculesLoaded: 0, error: 'timeout' });
            }, 120000);
        });
    }""", csv_text)

    return result


def benchmark_via_file_upload(page, csv_text: str, n: int) -> dict:
    """Upload CSV via file input and measure load time."""

    # Reset: navigate to fresh state
    page.goto(page.url.split("#")[0], wait_until="networkidle")
    page.wait_for_timeout(2000)  # RDKit WASM init

    # Write temp CSV file
    tmp_csv = SCRIPT_DIR / f"_tmp_bench_{n}.csv"
    tmp_csv.write_text(csv_text, encoding="utf-8")

    try:
        # Start timing
        t0 = time.perf_counter()

        # Find the file input and upload
        file_input = page.locator('input[type="file"]')
        if file_input.count() == 0:
            # Try clicking an upload button first
            upload_btn = page.locator('text=upload').first
            if upload_btn.count() > 0:
                upload_btn.click()
                page.wait_for_timeout(500)
            file_input = page.locator('input[type="file"]')

        file_input.set_input_files(str(tmp_csv))

        # Wait for "N MOLECULES LOADED" to appear
        page.wait_for_function(
            f"""() => {{
                const text = document.body.innerText;
                const match = text.match(/(\\d+)\\s*MOLECULES?\\s*LOADED/i);
                return match && parseInt(match[1]) >= {min(n, 1949)};
            }}""",
            timeout=120000,
        )

        t1 = time.perf_counter()
        load_time = (t1 - t0) * 1000  # ms

        # Extract additional metrics from the page
        metrics = page.evaluate("""() => {
            const text = document.body.innerText;
            const match = text.match(/(\\d+)\\s*MOLECULES?\\s*LOADED/i);
            const paretoMatch = text.match(/pareto/i);
            return {
                moleculesLoaded: match ? parseInt(match[1]) : 0,
                hasParetoInfo: !!paretoMatch,
            };
        }""")

        return {
            "n": n,
            "loadTimeMs": round(load_time, 1),
            "moleculesLoaded": metrics["moleculesLoaded"],
        }

    finally:
        tmp_csv.unlink(missing_ok=True)


def run_benchmarks(url: str, output_path: str):
    """Run the full benchmark suite."""
    smiles_pool = load_smiles_pool()
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
        )
        page = context.new_page()

        # Initial load — warm up WASM
        print(f"Loading {url} and warming up RDKit WASM...")
        page.goto(url, wait_until="networkidle")
        page.wait_for_timeout(5000)  # generous WASM init time
        print("Ready.\n")

        for n in SIZES:
            if n > len(smiles_pool):
                n = len(smiles_pool)

            csv_text = make_csv_subset(smiles_pool, n)
            times = []

            for run in range(REPEATS):
                print(f"  n={n:>5}, run {run+1}/{REPEATS} ... ", end="", flush=True)
                try:
                    result = benchmark_via_file_upload(page, csv_text, n)
                    t = result["loadTimeMs"]
                    loaded = result["moleculesLoaded"]
                    times.append(t)
                    print(f"{t:.0f} ms ({loaded} loaded)")
                except Exception as e:
                    print(f"FAILED: {e}")
                    times.append(-1)

            valid_times = [t for t in times if t > 0]
            if valid_times:
                entry = {
                    "n": n,
                    "mean_ms": round(statistics.mean(valid_times), 1),
                    "median_ms": round(statistics.median(valid_times), 1),
                    "min_ms": round(min(valid_times), 1),
                    "max_ms": round(max(valid_times), 1),
                    "std_ms": round(statistics.stdev(valid_times), 1) if len(valid_times) > 1 else 0,
                    "runs": len(valid_times),
                    "all_ms": [round(t, 1) for t in valid_times],
                }
            else:
                entry = {"n": n, "mean_ms": -1, "error": "all runs failed"}

            results.append(entry)
            print(f"  => n={n}: {entry.get('mean_ms', 'FAIL')} ms (mean)\n")

        browser.close()

    # Save results
    output = {
        "benchmark": "ParetoMol Load Performance",
        "url": url,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "repeats": REPEATS,
        "sizes": SIZES,
        "results": results,
    }

    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nResults saved to {out_path}")

    # Print table
    print("\n" + "=" * 70)
    print(f"{'Molecules':>10} {'Mean (ms)':>10} {'Median':>10} {'Min':>10} {'Max':>10} {'Std':>8}")
    print("-" * 70)
    for r in results:
        if r.get("mean_ms", -1) > 0:
            print(f"{r['n']:>10} {r['mean_ms']:>10.0f} {r['median_ms']:>10.0f} {r['min_ms']:>10.0f} {r['max_ms']:>10.0f} {r['std_ms']:>8.0f}")
        else:
            print(f"{r['n']:>10} {'FAILED':>10}")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ParetoMol Performance Benchmark")
    parser.add_argument("--url", default="https://paretomol.com", help="URL to benchmark")
    parser.add_argument("--output", default="benchmarks/results.json", help="Output JSON path")
    args = parser.parse_args()
    run_benchmarks(args.url, args.output)
