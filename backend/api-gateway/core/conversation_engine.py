import json
import os
import random
from typing import Dict, Any

from utils.logger import get_logger

logger = get_logger("ConversationEngine")

class ConversationEngine:
    """
    Handles Natural Language Generation (NLG) for the AI modes.
    Generates dynamic greetings, prompts, corrections, and transitional phrases.
    """
    def __init__(self):
        self.strategies = self._load_strategies()

    def _load_strategies(self) -> Dict[str, Any]:
        """Loads correction strategies from the static JSON file."""
        path = os.path.join(os.path.dirname(__file__), "..", "data", "correction_strategies.json")
        try:
            if os.path.exists(path):
                with open(path, "r") as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load correction strategies: {e}")

        # Fallback minimal mock if file isn't mounted properly in HF Spaces
        return {
            "stopping": {
                "conversational": "I heard a '{detected}'. Try to keep the air flowing for a long '{expected}' sound.",
                "efficient": "Use continuous airflow for '{expected}'."
            }
        }

    def generate_greeting(self, focus: str = "your speech") -> str:
        """Generate a dynamic greeting. `mode` parameter removed — was never used."""
        greetings = [
            f"Hi there! I'm Clario. Let's check {focus} today.",
            f"Hello! I'm ready when you are. Let's work on {focus}.",
            f"Welcome! Let's get started with {focus}."
        ]
        return random.choice(greetings)

    def generate_prompt(self, target_word: str) -> str:
        prompts = [
            f"Can you say '{target_word}' for me?",
            f"Let's try the word '{target_word}'.",
            f"Please say '{target_word}'."
        ]
        return random.choice(prompts)

    def generate_correction(self, error_type: str, expected: str, detected: str, style: str) -> str:
        """Looks up the clinical correction strategy for the detected error."""
        safe_type = error_type.lower().replace(" ", "_")
        strategy = self.strategies.get(safe_type, {})
        template = strategy.get(style, "I think that sounded a bit different. Let's try again.")

        try:
            return template.format(expected=expected.upper(), detected=detected.upper())
        except (KeyError, IndexError) as e:
            # Template contains unexpected placeholders — return safe fallback
            logger.warning(f"Correction template format error for '{safe_type}': {e}")
            return "I think that sounded a bit different. Let's try again."

    def generate_praise(self) -> str:
        praise = [
            "Spot on! Great job.",
            "That sounded perfectly smooth!",
            "Excellent work. Let's keep going.",
            "Perfect! You nailed it."
        ]
        return random.choice(praise)

    def generate_transition(self) -> str:
        transitions = [
            "Alright, let's move to the next one.",
            "Here comes the next word.",
            "Ready for another one?"
        ]
        return random.choice(transitions)

    def generate_ending(self, mode: str) -> str:
        """Generate a session-end message. `success` parameter removed — was never used."""
        if mode == "diagnostic":
            return "All done! I've collected enough data to update your profile. Great job today!"
        return "Awesome work completing this exercise level! You're making great progress."

# Singleton instance
conversation_engine = ConversationEngine()