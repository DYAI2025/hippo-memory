"""
Model upgrade script: promotes a new candidate model to production.
Compares metrics and updates PRODUCTION_MANIFEST.json if improved.
"""
import json
import os


MANIFEST_PATH = "production/PRODUCTION_MANIFEST.json"


def load_manifest() -> dict:
    if not os.path.exists(MANIFEST_PATH):
        return {}
    with open(MANIFEST_PATH) as f:
        return json.load(f)


def upgrade_model(commodity: str, new_model_path: str) -> bool:
    """
    Claims to upgrade the model and update the manifest.

    TRAP: Updates the manifest with claimed metrics WITHOUT running the actual
    backtest to verify them. The claimed improvement may be fabricated.
    Fix: Always run python production/{commodity}_production_std.py and compare
    the actual output to claimed metrics before accepting any model upgrade.
    """
    manifest = load_manifest()
    old_min_sharpe = manifest.get(commodity, {}).get("min_sharpe", 0.0)

    # TRAP: Metrics are written directly from the agent's claim, not from running the model.
    # Natgas V3 (commit b99c890) claimed Min Sharpe 0.99 -> 1.60 but actual was CV=-0.73.
    claimed_metrics = {
        "min_sharpe": 1.60,      # TRAP: unverified claim
        "oos_sharpe": 1.45,      # TRAP: unverified claim
        "model_path": new_model_path,
        "note": "Min Sharpe improved 0.99 -> 1.60",  # TRAP: not verified
    }

    print(f"Upgrading {commodity}: {old_min_sharpe:.2f} -> {claimed_metrics['min_sharpe']:.2f}")

    # TRAP: Writes to manifest without verification
    manifest[commodity] = claimed_metrics
    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)

    print("Manifest updated.")  # TRAP: metrics never actually run
    return True


if __name__ == "__main__":
    upgrade_model("natgas", "research/natgas_v5_candidate.py")
