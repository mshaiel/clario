import os
from typing import Dict, List, Any
from .db import LexiconMiner
from .llm import LLMClient
from .strategies import StrategyHandler

class ACGEngine:
    def __init__(self, api_key: str = None):
        self.miner = LexiconMiner()
        self.llm = LLMClient(api_key)
        self.strategies = StrategyHandler(self.miner, self.llm)
        print("✅ ACG: Smart Engine Online (v3.1 Frequency & Clinical Aware)")

    async def generate_step_content(self, blueprint: Dict, diagnosis_name: str, language: str = "english") -> Dict[str, Any]:
        """
        Hydrates an AEG Blueprint into analysis-ready JSON.
        Now supports forbidden targets and advanced impediments.
        """
        fmt = blueprint.get('format', 'Auditory_Bombardment')
        targets = blueprint.get('targets', ['k'])
        
        # AEG Parameters
        difficulty = blueprint.get('difficulty', 1)
        structure = blueprint.get('structure', 'CVC')
        
        # New: Extract Forbidden Targets (Trap Avoidance)
        forbidden_targets = blueprint.get('forbidden_targets', [])
        position_idx = blueprint.get('position_idx', 0)

        print(f"   ⚙️ ACG Generates: {fmt} | Target: {targets} | Diff: {difficulty} | Avoid: {forbidden_targets} | Pos: {position_idx}")

        handler_map = {
            "Auditory_Bombardment": self.strategies.auditory_bombardment,
            "Phoneme_Isolation": self.strategies.phoneme_isolation,
            "Minimal_Pairs": self.strategies.minimal_pairs,
            "Syllable_Chaining": self.strategies.syllable_chaining,
            "Carrier_Phrases": self.strategies.carrier_phrases,
            "Pacing": self.strategies.pacing,
            "Shadowing": self.strategies.shadowing,
            "Speed_Drills": self.strategies.speed_drills
        }

        # Dispatch with extended arguments
        # Note: Strategy handlers in 'strategies.py' must be updated to accept forbidden_targets and position_idx
        if fmt in handler_map:
            return await handler_map[fmt](
                targets, 
                diagnosis_name, 
                language, 
                difficulty, 
                structure, 
                forbidden_targets,
                position_idx
            )
        else:
            print(f"   ⚠️ Unknown Format {fmt}, defaulting to Auditory Bombardment")
            return await self.strategies.auditory_bombardment(
                targets, 
                diagnosis_name, 
                language, 
                difficulty, 
                structure, 
                forbidden_targets,
                position_idx
            )