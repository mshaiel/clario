"""
Request CTM /strategy/generate with a synthetic tensor and summarize the output.
"""
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List

import requests

from core.tensor_bridge import TensorBridge


def _build_tensor() -> List[List[List[float]]]:
    bridge = TensorBridge()
    tensor = bridge.initialize_tensor()

    # Synthetic clinical errors to trigger non-healthy output.
    events = [
        {"phoneme": "k", "process": "velar_fronting", "position": "initial"},
        {"phoneme": "g", "process": "velar_fronting", "position": "initial"},
        {"phoneme": "s", "process": "stopping", "position": "initial"},
        {"phoneme": "r", "process": "gliding", "position": "medial"},
        {"phoneme": "t", "process": "cluster_reduction", "position": "initial"},
        {"phoneme": "p", "process": "blocks", "position": "initial"},
    ]

    # Apply a strong EMA update to emphasize errors.
    return bridge.update_tensor(tensor, events, learning_rate=0.9)


def _summarize_response(data: Dict[str, Any]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "status": data.get("status"),
        "language": data.get("language"),
        "exercise_sets": [],
    }

    for ex_set in data.get("exercise_sets", []):
        levels = ex_set.get("levels", [])
        summary["exercise_sets"].append({
            "diagnosis": ex_set.get("diagnosis", {}).get("error_name"),
            "levels": [
                {
                    "format": lvl.get("format"),
                    "difficulty": lvl.get("difficulty"),
                    "item_count": _count_items(lvl.get("items")),
                }
                for lvl in levels
            ],
        })

    return summary


def _count_items(items: Any) -> int:
    if items is None:
        return 0
    if isinstance(items, list):
        return len(items)
    if isinstance(items, dict):
        if "items" in items and isinstance(items["items"], list):
            return len(items["items"])
        if "pairs" in items and isinstance(items["pairs"], list):
            return len(items["pairs"])
    return 0


def main() -> None:
    base_url = os.getenv("TRAINING_MODULE_URL", "https://junaiddbz-clario-training-module.hf.space").rstrip("/")
    url = f"{base_url}/strategy/generate"

    payload = {
        "current_tensor": _build_tensor(),
        "user_stats": {
            "severity": 0.85,
            "fatigue": 0.2,
            "age": 0.5,
            "delta": 0.0,
        },
        "language": "english",
        "force_easier": False,
    }

    print(f"POST {url}")
    response = requests.post(url, json=payload, timeout=30)
    response.raise_for_status()
    data = response.json()

    summary = _summarize_response(data)

    # Save full response to test_results for later review.
    root_dir = Path(__file__).resolve().parents[1]
    out_dir = root_dir / "test_results"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"ctm_space_tensor_{stamp}.json"
    out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    print("\nSummary:")
    print(json.dumps(summary, indent=2))
    print(f"\nSaved full response to: {out_path}")


if __name__ == "__main__":
    main()
