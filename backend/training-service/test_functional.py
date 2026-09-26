import os
import json
import traceback
from fastapi.testclient import TestClient

from main import app
from core.tensor_bridge import TensorBridge

def build_tensor():
    bridge = TensorBridge()
    tensor = bridge.initialize_tensor()
    events = [
        {"phoneme": "k", "process": "velar_fronting", "position": "initial"},
        {"phoneme": "p", "process": "blocks", "position": "initial"},
    ]
    return bridge.update_tensor(tensor, events, learning_rate=0.9)

def main():
    print("Initializing TestClient (this will load models)...")
    try:
        with TestClient(app) as client:
            print("Models loaded successfully. Testing /strategy/generate...")
            
            payload = {
                "current_tensor": build_tensor(),
                "user_stats": {
                    "severity": 0.85,
                    "fatigue": 0.2,
                    "age": 0.5,
                    "delta": 0.0,
                },
                "language": "english",
                "force_easier": False,
            }
            
            # Test 1: Normal generation
            print("\n--- TEST 1: Normal Generation ---")
            response = client.post("/strategy/generate", json=payload)
            if response.status_code == 200:
                data = response.json()
                print("Status:", data.get("status"))
                print("Exercise Sets:", len(data.get("exercise_sets", [])))
                for ex_set in data.get("exercise_sets", []):
                    diag = ex_set.get("diagnosis", {})
                    levels = ex_set.get("levels", [])
                    print(f"  - {diag.get('error_name')}: Severity {diag.get('severity')}, Levels: {len(levels)}")
            else:
                print("Failed:", response.status_code, response.text)

            # Test 2: force_easier
            print("\n--- TEST 2: force_easier=True ---")
            payload["force_easier"] = True
            response2 = client.post("/strategy/generate", json=payload)
            if response2.status_code == 200:
                data2 = response2.json()
                print("Status:", data2.get("status"))
                for ex_set in data2.get("exercise_sets", []):
                    diag = ex_set.get("diagnosis", {})
                    levels = ex_set.get("levels", [])
                    print(f"  - {diag.get('error_name')}: Severity {diag.get('severity')}, Levels: {len(levels)}")
            else:
                print("Failed:", response2.status_code, response2.text)
                
            print("\nFunctional test complete.")
    except Exception as e:
        print(f"Error during functional test: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    main()
