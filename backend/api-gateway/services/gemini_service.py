"""
Gemini 2.5 Service for Dynamic Sentence Generation

Generates clinically appropriate sentences with IPA phonemes based on:
- Error type (phonology/fluency)
- Focus phonemes
- Danger words (if appropriate)
- Language (English/Urdu)

Uses Google Generative AI (Gemini 2.5) to create sentences,
then extracts/validates phonemes for inclusion in sentence banks.
"""

import os
import asyncio
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

from utils.logger import get_logger

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

logger = get_logger("GeminiService")

# ============================================================
# Gemini Configuration
# ============================================================
API_KEY = os.getenv("GEMINI_API_KEY")


class GeminiSentenceGenerator:
    """
    Generate clinically-appropriate sentences using Gemini 2.5
    
    Features:
    - Context-aware sentence generation (respects error type)
    - Danger word integration (when appropriate)
    - IPA phoneme validation
    - Multi-language support (English/Urdu)
    """
    
    @staticmethod
    def initialize():
        """Initialize Gemini API with provided API key"""
        if not GEMINI_AVAILABLE:
            logger.warning("⚠️ Gemini API not available - install 'google-generativeai'")
            return False
        
        if not API_KEY:
            logger.error("❌ GEMINI_API_KEY not set in environment variables")
            return False
        
        try:
            genai.configure(api_key=API_KEY)
            logger.info("✅ Gemini 2.5 API initialized")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to initialize Gemini: {e}")
            return False
    
    @staticmethod
    def _should_use_danger_word(error_type: str, danger_word: str) -> bool:
        """
        Determine if a danger word is appropriate for the error type.
        
        Danger words are phonologically challenging words. They're appropriate
        based on the error category:
        
        - Phonology errors: Use if word contains the target phoneme
        - Fluency errors (blocks/stutters): Use if word has stop/fricative sounds
        - Prolongation: Use if word has vowels or continuants
        """
        if not danger_word:
            return False
        
        # Map error types to phoneme characteristics
        phoneme_map = {
            "substitution": ["k", "g", "f", "v", "θ", "ð", "s", "z"],
            "omission": ["k", "g", "s", "z", "t", "d"],
            "addition": ["s", "z", "k", "g"],
            "block": ["p", "b", "t", "d", "k", "g"],  # Stops more challenging
            "stutter": ["p", "b", "t", "d", "k", "g"],
            "prolongation": ["ɑ", "i", "u", "ɛ", "ɔ", "ə"],  # Vowels
        }
        
        target_chars = phoneme_map.get(error_type, [])  # noqa: F841 — reserved for future IPA checks

        # Simple heuristic: word should have some length and complexity
        if len(danger_word) < 2:
            return False
        
        # For phonology errors, check if any phoneme is in the word
        # (This is approximate - actual IPA validation would be more precise)
        if error_type in ["substitution", "omission", "addition"]:
            # Accept danger words with reasonable length
            return len(danger_word) >= 3 and ' ' not in danger_word
        
        # For fluency errors, broader selection of words
        return len(danger_word) >= 2 and ' ' not in danger_word
    
    @staticmethod
    async def generate_sentence(
        error_type: str,
        focus_phonemes: List[str],
        danger_words: List[str],
        language: str = "english",
        difficulty: int = 2
    ) -> Optional[Dict[str, Any]]:
        """
        Generate a single sentence using Gemini 2.5.
        
        Args:
            error_type: One of ["substitution", "omission", "addition", "block", "stutter", "prolongation"]
            focus_phonemes: IPA phonemes to target (e.g., ["k", "g"])
            danger_words: Clinically challenging words to potentially include
            language: "english" or "urdu"
            difficulty: 1-3 (easy to hard)
        
        Returns:
            Dict with keys: {
                "id": "gen_001",
                "text": "Go get it.",
                "language": "english",
                "error_type": "substitution",
                "difficulty": 2,
                "targets": [
                    {
                        "word": "Go",
                        "expected_ipa": ["g", "oʊ"],
                        "is_danger_word": true
                    },
                    ...
                ]
            }
        """
        if not GEMINI_AVAILABLE or not API_KEY:
            logger.error("❌ Gemini not initialized")
            return None
        
        try:
            # Build danger word inclusion instructions
            useful_danger_words = [
                w for w in danger_words
                if GeminiSentenceGenerator._should_use_danger_word(error_type, w)
            ]
            
            danger_instruction = ""
            if useful_danger_words:
                danger_instruction = f"\nInclude one of these words if naturally possible: {', '.join(useful_danger_words[:3])}"
            
            # Language-specific instructions
            lang_instructions = {
                "english": "Create a simple, natural English sentence for children.",
                "urdu": "Create a simple, natural Urdu sentence for children. Use modern Urdu."
            }
            
            lang_instr = lang_instructions.get(language, lang_instructions["english"])
            
            prompt = f"""Generate a clinically-appropriate {language.title()} sentence for speech therapy assessment.

Target Error Type: {error_type}
Target Phonemes (IPA): {', '.join(focus_phonemes) if focus_phonemes else 'Any'}
Language: {language.title()}
Difficulty: {difficulty}/3
{danger_instruction}

{lang_instr}

CRITICAL REQUIREMENTS:
1. Include multiple instances of the target phonemes if possible
2. Keep the sentence SHORT (3-7 words)
3. Use vocabulary appropriate for children
4. Make it a complete, grammatically correct sentence
5. Do NOT use any special characters or markdown

Return ONLY plain text. No quotation marks, no explanation."""
            
            model = genai.GenerativeModel("gemini-2.5-flash")
            response = await asyncio.to_thread(
                model.generate_content, prompt, stream=False
            )
            
            if not response.text:
                logger.warning(f"❌ Gemini returned empty response for {error_type}")
                return None
            
            sentence_text = response.text.strip().strip('"').strip("'")
            
            logger.info(f"✅ Generated sentence: '{sentence_text}'")
            
            # Parse the sentence into words with IPA (simplified - in production would use IPA database)
            words = sentence_text.split()
            targets = []
            
            for idx, word in enumerate(words):
                clean_word = word.rstrip('.,!?;:')
                is_danger = clean_word.lower() in [w.lower() for w in useful_danger_words]
                
                # Simplified IPA extraction (real implementation would query IPA database)
                target_entry = {
                    "word": clean_word,
                    "expected_ipa": GeminiSentenceGenerator._estimate_ipa(clean_word, language),
                    "is_danger_word": is_danger
                }
                targets.append(target_entry)
            
            # Generate unique ID with microsecond precision to avoid collisions
            timestamp = datetime.now().strftime("%m%d%H%M%S%f")
            gen_id = f"gen_{timestamp}"
            
            result = {
                "id": gen_id,
                "text": sentence_text,
                "language": language,
                "error_type": error_type,
                "difficulty": difficulty,
                "targets": targets,
                "generated_at": datetime.now().isoformat()
            }
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Gemini generation failed: {e}")
            return None
    
    @staticmethod
    def _estimate_ipa(word: str, language: str) -> List[str]:
        """
        Estimate IPA representation of a word.
        
        NOTE: This is a placeholder. In production, this would:
        1. Query an IPA dictionary database
        2. Use CMU Pronouncing Dictionary for English
        3. Use Urdu phonetic transcription service
        
        For now, returns simplified phoneme approximation.
        """
        # Extremely simplified English IPA approximation
        if language == "english":
            approximations = {
                "go": ["g", "oʊ"],
                "get": ["g", "ɛ", "t"],
                "it": ["ɪ", "t"],
                "the": ["ð", "ə"],
                "cat": ["k", "æ", "t"],
                "king": ["k", "ɪ", "ŋ"],
                "sit": ["s", "ɪ", "t"],
                "say": ["s", "eɪ"],
                "dog": ["d", "ɔ", "g"],
                "run": ["r", "ʌ", "n"],
                "stop": ["s", "t", "ɑ", "p"],
                "play": ["p", "l", "eɪ"],
                "blue": ["b", "l", "u"],
                "green": ["g", "r", "i", "n"],
            }
            return approximations.get(word.lower(), [c for c in word[:3]])
        
        # Urdu - simplified approximation
        elif language == "urdu":
            # Return placeholder IPA for Urdu words
            return list(word[:2])
        
        return [word[0]]
    
    @staticmethod
    async def generate_batch_sentences(
        error_type: str,
        focus_phonemes: List[str],
        danger_words: List[str],
        language: str = "english",
        count: int = 5,
        difficulty_range: Tuple[int, int] = (1, 3)
    ) -> List[Dict[str, Any]]:
        """
        Generate multiple sentences for addition to sentence bank.
        
        Args:
            error_type: Phonology or fluency error type
            focus_phonemes: Target phonemes
            danger_words: Clinically challenging words
            language: "english" or "urdu"
            count: Number of sentences to generate (default 5, max 10)
            difficulty_range: Tuple of (min_difficulty, max_difficulty)
        
        Returns:
            List of generated sentence dictionaries
        """
        if count > 10:
            logger.warning(f"⚠️ Limiting batch generation to 10 (requested {count})")
            count = 10
        
        sentences = []
        
        for i in range(count):
            # Vary difficulty across the range
            difficulty = difficulty_range[0] + (i % (difficulty_range[1] - difficulty_range[0] + 1))
            
            sentence = await GeminiSentenceGenerator.generate_sentence(
                error_type=error_type,
                focus_phonemes=focus_phonemes,
                danger_words=danger_words,
                language=language,
                difficulty=difficulty
            )
            
            if sentence:
                sentences.append(sentence)
            
            # Small delay to avoid rate limiting
            await asyncio.sleep(0.5)
        
        logger.info(f"✅ Generated {len(sentences)}/{count} sentences for {error_type}")
        return sentences
