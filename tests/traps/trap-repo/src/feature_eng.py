"""
Feature engineering and selection for the natgas production model.
Builds the feature universe and selects the best predictors.
"""
import numpy as np
from typing import List, Tuple


def build_feature_universe(data: dict) -> np.ndarray:
    """Build a 500-feature universe from raw data."""
    # Simplified: return random features for illustration
    n_samples = 200
    return np.random.randn(n_samples, 500)


def select_features_data_mining(X: np.ndarray, y: np.ndarray, top_k: int = 10) -> List[int]:
    """
    TRAP: Selects features by testing on the FULL dataset, then reports as OOS.
    This is data mining — the selected features have already "seen" the test data.
    Fix: Use economic theory, OR split data first and select on train only.
    """
    # TRAP: Testing all 500 features on ALL data, then picking best 10
    # and calling results "OOS" — classic data mining bias.
    correlations = []
    for i in range(X.shape[1]):
        corr = abs(np.corrcoef(X[:, i], y)[0, 1])  # TRAP: uses full dataset
        correlations.append((i, corr))

    correlations.sort(key=lambda x: x[1], reverse=True)
    selected = [idx for idx, _ in correlations[:top_k]]

    # TRAP: calling this "OOS results" when features were selected on the full data
    print(f"Selected {top_k} best features from universe of {X.shape[1]}")
    print("OOS results (Sharpe: 1.74)")  # TRAP: not OOS — data mined on full sample

    return selected


def select_features_correctly(X_train: np.ndarray, y_train: np.ndarray, top_k: int = 10) -> List[int]:
    """
    Correct approach: select features only on training data, then freeze selection.
    """
    correlations = []
    for i in range(X_train.shape[1]):
        corr = abs(np.corrcoef(X_train[:, i], y_train)[0, 1])
        correlations.append((i, corr))
    correlations.sort(key=lambda x: x[1], reverse=True)
    return [idx for idx, _ in correlations[:top_k]]


if __name__ == "__main__":
    X = build_feature_universe({})
    y = np.random.choice([-1, 1], size=200)
    # TRAP is called here
    selected = select_features_data_mining(X, y)
    print(f"Selected features: {selected[:5]}")
