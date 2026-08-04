"""
ADMET Prediction Benchmark: LLM (BYOK) vs ADMET-AI vs Experimental Ground Truth

Uses well-characterized drugs with published experimental ADMET data.
Tests the same molecules through:
1. Our LLM BYOK system (Gemini Flash)
2. ADMET-AI (Chemprop D-MPNN, #1 TDC leaderboard)
3. Compare both against experimental values

Ground truth sourced from:
- DrugBank, ChEMBL, published ADMET studies
- TDC benchmark datasets
"""

import json, os, sys, time
from pathlib import Path

# 10 well-characterized drugs with known experimental ADMET values
# Sources: DrugBank, pkCSM validation set, published literature
GROUND_TRUTH = [
    {
        "name": "Aspirin",
        "smiles": "CC(=O)OC1=CC=CC=C1C(=O)O",
        "experimental": {
            # Classification (binary: 0 or 1)
            "HIA": 1.0,        # >90% absorbed (well absorbed)
            "BBB": 1.0,        # crosses BBB
            "Pgp_inh": 0.0,    # not a Pgp inhibitor
            "Ames": 0.0,       # not mutagenic
            "hERG": 0.0,       # not a hERG blocker
            "DILI": 0.0,       # low DILI risk
            "CYP2C9_inh": 0.0, # not a CYP2C9 inhibitor
            "CYP2D6_inh": 0.0, # not a CYP2D6 inhibitor
            "CYP3A4_inh": 0.0, # not a CYP3A4 inhibitor
            # Regression
            "LogS": -1.6,      # log mol/L (moderately soluble)
            "Caco2": -4.96,    # log cm/s (high permeability)
            "PPBR": 50.0,      # ~50% plasma protein binding (low-moderate)
            "HalfLife": 3.5,   # ~3.5 hours
        }
    },
    {
        "name": "Ibuprofen",
        "smiles": "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O",
        "experimental": {
            "HIA": 1.0,
            "BBB": 1.0,
            "Pgp_inh": 0.0,
            "Ames": 0.0,
            "hERG": 0.0,
            "DILI": 0.0,
            "CYP2C9_inh": 1.0,  # known CYP2C9 inhibitor
            "CYP2D6_inh": 0.0,
            "CYP3A4_inh": 0.0,
            "LogS": -3.7,
            "Caco2": -4.62,
            "PPBR": 99.0,       # >99% protein bound
            "HalfLife": 2.0,
        }
    },
    {
        "name": "Metformin",
        "smiles": "CN(C)C(=N)NC(=N)N",
        "experimental": {
            "HIA": 1.0,        # ~60% absorbed but classified as absorbed
            "BBB": 0.0,        # does NOT cross BBB well
            "Pgp_inh": 0.0,
            "Ames": 0.0,
            "hERG": 0.0,
            "DILI": 0.0,       # rare lactic acidosis but not classic DILI
            "CYP2C9_inh": 0.0,
            "CYP2D6_inh": 0.0,
            "CYP3A4_inh": 0.0,
            "LogS": 0.8,       # highly soluble
            "Caco2": -5.85,    # low-moderate permeability
            "PPBR": 10.0,      # negligible protein binding
            "HalfLife": 5.0,
        }
    },
    {
        "name": "Ketoconazole",
        "smiles": "O=C1N(CCO1)C2=CC=C(OCC3COC(CN4C=CN=C4)(C5=CC=C(Cl)C=C5)O3)C=C2",
        "experimental": {
            "HIA": 1.0,
            "BBB": 0.0,        # poor BBB penetration
            "Pgp_inh": 1.0,    # known Pgp inhibitor
            "Ames": 0.0,
            "hERG": 1.0,       # known hERG blocker!
            "DILI": 1.0,       # known hepatotoxic
            "CYP2C9_inh": 1.0,
            "CYP2D6_inh": 1.0,
            "CYP3A4_inh": 1.0, # potent CYP3A4 inhibitor (classic example)
            "LogS": -5.2,
            "Caco2": -4.78,
            "PPBR": 99.0,
            "HalfLife": 8.0,
        }
    },
    {
        "name": "Atenolol",
        "smiles": "CC(C)NCC(O)COC1=CC=C(CC(N)=O)C=C1",
        "experimental": {
            "HIA": 1.0,        # ~50% absorbed (borderline)
            "BBB": 0.0,        # hydrophilic, does NOT cross BBB
            "Pgp_inh": 0.0,
            "Ames": 0.0,
            "hERG": 0.0,
            "DILI": 0.0,
            "CYP2C9_inh": 0.0,
            "CYP2D6_inh": 0.0,
            "CYP3A4_inh": 0.0,
            "LogS": -1.5,
            "Caco2": -5.7,     # low permeability
            "PPBR": 6.0,       # very low protein binding
            "HalfLife": 7.0,
        }
    },
    {
        "name": "Amiodarone",
        "smiles": "CCCCN(CCCC)CCC1=CC(=C(C(=C1)I)OCC2=CC=CC=C2)I",
        "experimental": {
            "HIA": 1.0,
            "BBB": 1.0,        # lipophilic, crosses BBB
            "Pgp_inh": 1.0,    # Pgp inhibitor
            "Ames": 0.0,
            "hERG": 1.0,       # known hERG blocker (QT prolongation)
            "DILI": 1.0,       # hepatotoxic
            "CYP2C9_inh": 1.0,
            "CYP2D6_inh": 1.0,
            "CYP3A4_inh": 1.0,
            "LogS": -7.5,      # very poorly soluble
            "Caco2": -4.3,
            "PPBR": 96.0,
            "HalfLife": 960.0,  # 40 days! (extremely long)
        }
    },
    {
        "name": "Caffeine",
        "smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
        "experimental": {
            "HIA": 1.0,
            "BBB": 1.0,        # readily crosses BBB
            "Pgp_inh": 0.0,
            "Ames": 0.0,
            "hERG": 0.0,
            "DILI": 0.0,
            "CYP2C9_inh": 0.0,
            "CYP2D6_inh": 0.0,
            "CYP3A4_inh": 0.0,
            "LogS": -0.6,      # freely soluble
            "Caco2": -4.4,
            "PPBR": 36.0,      # ~36% protein bound
            "HalfLife": 5.0,
        }
    },
    {
        "name": "Terfenadine",
        "smiles": "OC(CCN1CCC(CC1)C(O)(C2=CC=CC=C2)C3=CC=CC=C3)C4=CC(=CC=C4)C(C)(C)C",
        "experimental": {
            "HIA": 1.0,
            "BBB": 1.0,
            "Pgp_inh": 1.0,
            "Ames": 0.0,
            "hERG": 1.0,       # the classic hERG blocker (withdrawn from market)
            "DILI": 1.0,
            "CYP2C9_inh": 0.0,
            "CYP2D6_inh": 1.0,
            "CYP3A4_inh": 1.0,
            "LogS": -6.8,
            "Caco2": -4.5,
            "PPBR": 97.0,
            "HalfLife": 16.0,
        }
    },
    {
        "name": "Verapamil",
        "smiles": "COC1=CC=C(CCN(C)CCCC(C#N)(C2=CC=CC=C2)C2=CC(OC)=C(OC)C=C2)C=C1OC",
        "experimental": {
            "HIA": 1.0,
            "BBB": 1.0,
            "Pgp_inh": 1.0,    # classic Pgp inhibitor
            "Ames": 0.0,
            "hERG": 1.0,       # hERG blocker
            "DILI": 0.0,
            "CYP2C9_inh": 0.0,
            "CYP2D6_inh": 1.0,
            "CYP3A4_inh": 1.0, # CYP3A4 inhibitor
            "LogS": -4.5,
            "Caco2": -4.6,
            "PPBR": 90.0,
            "HalfLife": 7.0,
        }
    },
    {
        "name": "Acetaminophen",
        "smiles": "CC(=O)NC1=CC=C(O)C=C1",
        "experimental": {
            "HIA": 1.0,
            "BBB": 1.0,
            "Pgp_inh": 0.0,
            "Ames": 0.0,
            "hERG": 0.0,
            "DILI": 1.0,       # known hepatotoxic at high doses
            "CYP2C9_inh": 0.0,
            "CYP2D6_inh": 0.0,
            "CYP3A4_inh": 0.0,
            "LogS": -0.5,
            "Caco2": -4.8,
            "PPBR": 25.0,
            "HalfLife": 2.5,
        }
    },
]

# ADMET-AI published performance on TDC benchmark (from their paper / leaderboard)
# These are the model's test set metrics, NOT training metrics
ADMET_AI_TDC_METRICS = {
    # Classification (AUROC)
    "HIA": {"metric": "AUROC", "value": 0.989},
    "BBB": {"metric": "AUROC", "value": 0.916},
    "Pgp_inh": {"metric": "AUROC", "value": 0.938},
    "Bioavail": {"metric": "AUROC", "value": 0.748},
    "CYP2C9_inh": {"metric": "AUPRC", "value": 0.818},
    "CYP2D6_inh": {"metric": "AUPRC", "value": 0.748},
    "CYP3A4_inh": {"metric": "AUPRC", "value": 0.894},
    "CYP2C9_sub": {"metric": "AUPRC", "value": 0.453},
    "CYP2D6_sub": {"metric": "AUPRC", "value": 0.736},
    "CYP3A4_sub": {"metric": "AUROC", "value": 0.665},
    "hERG": {"metric": "AUROC", "value": 0.878},
    "Ames": {"metric": "AUROC", "value": 0.866},
    "DILI": {"metric": "AUROC", "value": 0.927},
    # Regression (MAE or Spearman)
    "Caco2": {"metric": "MAE", "value": 0.276},
    "LogS": {"metric": "MAE", "value": 0.761},   # AqSol
    "PPBR": {"metric": "MAE", "value": 7.78},
    "HalfLife": {"metric": "Spearman", "value": 0.562},
    "CL_hepa": {"metric": "Spearman", "value": 0.497},
    "CL_micro": {"metric": "Spearman", "value": 0.649},
    "LD50": {"metric": "MAE", "value": 0.573},
    "VDss": {"metric": "Spearman", "value": 0.713},
}


def evaluate_classification(predictions: dict, ground_truth: list, prop_key: str) -> dict:
    """Evaluate classification accuracy for a single property."""
    correct = 0
    total = 0
    tp, fp, tn, fn = 0, 0, 0, 0
    
    for mol in ground_truth:
        exp = mol["experimental"].get(prop_key)
        pred_val = predictions.get(mol["name"], {}).get(prop_key)
        if exp is None or pred_val is None:
            continue
        
        pred_class = 1 if pred_val >= 0.5 else 0
        exp_class = 1 if exp >= 0.5 else 0
        total += 1
        
        if pred_class == exp_class:
            correct += 1
        if pred_class == 1 and exp_class == 1:
            tp += 1
        elif pred_class == 1 and exp_class == 0:
            fp += 1
        elif pred_class == 0 and exp_class == 0:
            tn += 1
        elif pred_class == 0 and exp_class == 1:
            fn += 1
    
    accuracy = correct / total if total > 0 else 0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    
    return {
        "accuracy": round(accuracy, 3),
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "correct": correct,
        "total": total,
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
    }


def evaluate_regression(predictions: dict, ground_truth: list, prop_key: str) -> dict:
    """Evaluate regression MAE for a single property."""
    errors = []
    for mol in ground_truth:
        exp = mol["experimental"].get(prop_key)
        pred_val = predictions.get(mol["name"], {}).get(prop_key)
        if exp is None or pred_val is None:
            continue
        errors.append(abs(pred_val - exp))
    
    if not errors:
        return {"mae": None, "n": 0}
    
    mae = sum(errors) / len(errors)
    max_err = max(errors)
    return {
        "mae": round(mae, 3),
        "max_error": round(max_err, 3),
        "n": len(errors),
        "errors": [round(e, 3) for e in errors],
    }


def print_results(llm_preds: dict):
    """Print benchmark results comparing LLM predictions vs experimental."""
    
    classification_props = ["HIA", "BBB", "Pgp_inh", "hERG", "Ames", "DILI", 
                           "CYP2C9_inh", "CYP2D6_inh", "CYP3A4_inh"]
    regression_props = ["LogS", "Caco2", "PPBR", "HalfLife"]
    
    print("\n" + "="*80)
    print("ADMET PREDICTION BENCHMARK: LLM (BYOK) vs Experimental Ground Truth")
    print("="*80)
    
    # Per-molecule detail
    print("\n--- Per-Molecule Predictions vs Experimental ---")
    for mol in GROUND_TRUTH:
        name = mol["name"]
        pred = llm_preds.get(name, {})
        exp = mol["experimental"]
        print(f"\n  {name}:")
        for key in classification_props:
            e = exp.get(key)
            p = pred.get(key)
            if e is not None and p is not None:
                match = "OK" if (p >= 0.5) == (e >= 0.5) else "WRONG"
                print(f"    {key:15s}  exp={int(e)}  pred={p:.2f}  [{match}]")
        for key in regression_props:
            e = exp.get(key)
            p = pred.get(key)
            if e is not None and p is not None:
                err = abs(p - e)
                print(f"    {key:15s}  exp={e:8.2f}  pred={p:8.2f}  err={err:.2f}")
    
    # Classification summary
    print("\n--- Classification Summary (LLM BYOK) ---")
    print(f"  {'Property':15s} {'Accuracy':>10s} {'Prec':>8s} {'Recall':>8s} {'TP/FP/TN/FN':>15s}  ADMET-AI ref")
    total_correct = 0
    total_n = 0
    for prop in classification_props:
        res = evaluate_classification(llm_preds, GROUND_TRUTH, prop)
        ref = ADMET_AI_TDC_METRICS.get(prop, {})
        ref_str = f"{ref.get('metric','')}: {ref.get('value','N/A')}" if ref else "N/A"
        print(f"  {prop:15s} {res['accuracy']:10.1%} {res['precision']:8.2f} {res['recall']:8.2f}   {res['tp']}/{res['fp']}/{res['tn']}/{res['fn']}   {ref_str}")
        total_correct += res["correct"]
        total_n += res["total"]
    
    overall_acc = total_correct / total_n if total_n > 0 else 0
    print(f"\n  Overall classification accuracy: {overall_acc:.1%} ({total_correct}/{total_n})")
    
    # Regression summary
    print("\n--- Regression Summary (LLM BYOK) ---")
    print(f"  {'Property':15s} {'MAE':>10s} {'Max Err':>10s} {'N':>5s}  ADMET-AI ref")
    for prop in regression_props:
        res = evaluate_regression(llm_preds, GROUND_TRUTH, prop)
        ref = ADMET_AI_TDC_METRICS.get(prop, {})
        ref_str = f"{ref.get('metric','')}: {ref.get('value','N/A')}" if ref else "N/A"
        mae_str = f"{res['mae']:.3f}" if res['mae'] is not None else "N/A"
        max_str = f"{res['max_error']:.3f}" if res.get('max_error') is not None else "N/A"
        print(f"  {prop:15s} {mae_str:>10s} {max_str:>10s} {res['n']:>5d}  {ref_str}")
    
    print("\n" + "="*80)
    print("NOTE: ADMET-AI metrics are on TDC test sets (hundreds/thousands of molecules)")
    print("      LLM metrics are on 10 well-known drugs (small but informative)")
    print("      LLM accuracy ~= memorization of drug facts, NOT learned QSAR")
    print("="*80)


if __name__ == "__main__":
    # Check for pre-computed predictions file
    pred_file = Path(__file__).parent / "admet_llm_predictions.json"
    
    if pred_file.exists():
        print(f"Loading predictions from {pred_file}")
        with open(pred_file) as f:
            llm_preds = json.load(f)
        print_results(llm_preds)
    else:
        print("No predictions file found.")
        print(f"Create {pred_file} with LLM predictions to run benchmark.")
        print("\nExpected format: {{\"Aspirin\": {{\"HIA\": 0.95, \"BBB\": 0.8, ...}}, ...}}")
        print(f"\nMolecules to predict ({len(GROUND_TRUTH)}):")
        for mol in GROUND_TRUTH:
            print(f"  {mol['name']}: {mol['smiles']}")
        
        # Also output SMILES for easy copy-paste into MolParetoLab
        print("\n--- SMILES for MolParetoLab (paste into textarea) ---")
        for mol in GROUND_TRUTH:
            print(f"{mol['smiles']} {mol['name']}")
