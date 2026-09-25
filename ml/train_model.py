import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import joblib

# Generate synthetic truck data

np.random.seed(42)

rows = 2000

data = pd.DataFrame({
    "coolant_temp": np.random.randint(70, 120, rows),
    "oil_temp": np.random.randint(70, 140, rows),
    "battery_voltage": np.random.uniform(10, 15, rows),
    "rpm": np.random.randint(500, 3000, rows),
    "engine_load": np.random.uniform(10, 100, rows),
    "speed": np.random.randint(0, 120, rows)
})

# Breakdown logic

data["breakdown"] = (
    (data["coolant_temp"] > 105) |
    (data["oil_temp"] > 120) |
    (data["battery_voltage"] < 11.5) |
    (data["engine_load"] > 90)
).astype(int)

# Features and labels

X = data.drop("breakdown", axis=1)
y = data["breakdown"]

# Train model

model = RandomForestClassifier(
    n_estimators=100,
    random_state=42
)

model.fit(X, y)

# Save model

joblib.dump(model, "model.pkl")

print("MODEL SAVED")