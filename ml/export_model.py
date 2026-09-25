"""Export model.pkl to JSON so the fleet server can score readings without Python.

Writes:
  dashboard/server/ml/maintenance_forest.json   every tree as flat node arrays
  dashboard/server/test/fixtures/maintenance_forest_cases.json
                                                 inputs + sklearn probabilities, used by
                                                 the server tests to check the port matches

Run from the repo root:  python ml/export_model.py
"""

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

ROOT = Path(__file__).resolve().parent.parent
MODEL = Path(__file__).resolve().parent / "model.pkl"
OUT = ROOT / "dashboard" / "server" / "ml" / "maintenance_forest.json"
CASES = ROOT / "dashboard" / "server" / "test" / "fixtures" / "maintenance_forest_cases.json"

model = joblib.load(MODEL)
features = [str(f) for f in model.feature_names_in_]
positive = list(model.classes_).index(1)

trees = []
for est in model.estimators_:
    t = est.tree_
    value = t.value[:, 0, :]
    proba = value[:, positive] / value.sum(axis=1)
    leaf = t.children_left == -1
    trees.append({
        # feature index per node, -1 at a leaf
        "f": [int(x) if not l else -1 for x, l in zip(t.feature, leaf)],
        # go left when the reading (as float32) <= threshold
        "t": [float(x) if not l else 0 for x, l in zip(t.threshold, leaf)],
        "l": [int(x) for x in t.children_left],
        "r": [int(x) for x in t.children_right],
        # probability of breakdown at a leaf, 0 elsewhere
        "p": [float(x) if l else 0 for x, l in zip(proba, leaf)],
    })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "name": "maintenance-breakdown-rf",
    "sklearn_version": sklearn.__version__,
    "features": features,
    "trees": trees,
}, separators=(",", ":")))

# Parity cases: the training ranges, readings right at the rule edges, and values
# outside the training ranges (engine off, cold engine, high rpm).
rng = np.random.default_rng(7)
n = 1500
cases = pd.DataFrame({
    "coolant_temp": rng.uniform(20, 140, n).round(1),
    "oil_temp": rng.uniform(20, 160, n).round(1),
    "battery_voltage": rng.uniform(9, 15.5, n).round(2),
    "rpm": rng.integers(0, 4500, n),
    "engine_load": rng.uniform(0, 100, n).round(1),
    "speed": rng.integers(0, 130, n),
})
edges = []
base = {"coolant_temp": 88, "oil_temp": 95, "battery_voltage": 13.8, "rpm": 1500, "engine_load": 50, "speed": 60}
for field, values in {
    "coolant_temp": [104.5, 105, 105.5, 106],
    "oil_temp": [120, 120.5, 121],
    "battery_voltage": [11.49, 11.5, 11.51],
    "engine_load": [89.9, 90, 90.1],
    "rpm": [0, 499, 500],
}.items():
    for v in values:
        edges.append({**base, field: v})
cases = pd.concat([cases, pd.DataFrame(edges)], ignore_index=True)[features]
proba = model.predict_proba(cases)[:, positive]

CASES.parent.mkdir(parents=True, exist_ok=True)
CASES.write_text(json.dumps({
    "features": features,
    "cases": [{"x": [float(v) for v in row], "p": float(p)} for row, p in zip(cases.to_numpy(), proba)],
}, separators=(",", ":")))

nodes = sum(len(t["f"]) for t in trees)
print(f"{len(trees)} trees, {nodes} nodes -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
print(f"{len(cases)} parity cases -> {CASES.relative_to(ROOT)}")
