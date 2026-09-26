import os
import json
import httpx
import random
import asyncio
import re
from typing import List, Dict

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

class LLMClient:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        # Reuse a single HTTP client for all Gemini calls (avoids TCP setup per request)
        self._client = httpx.AsyncClient(timeout=5.0)
        # Cache for carrier phrase frames: (category, language) -> str
        # Max 14 combinations (7 categories × 2 languages), so no eviction needed
        self._carrier_cache: dict = {}
        # Cache for sentence maps: (language, word_list) -> dict
        self._sentence_cache: dict = {}

    def _normalize_token(self, text: str) -> str:
        return re.sub(r"[^\w\u0600-\u06FF]", "", str(text or "")).lower()

    async def generate_sentences(self, word_data: List[Dict], language: str) -> dict:
        """
        Attempts to use Gemini. If Rate Limited (429) or Failed, 
        switches to a POS-Aware Offline Engine with vast variety.
        """
        word_list = [str(w.get("word", "")).strip() for w in word_data]
        cache_key = (language.lower(), tuple(word_list))
        if cache_key in self._sentence_cache:
            return dict(self._sentence_cache[cache_key])

        if not self.api_key:
            offline = self._offline_sentences(word_data, language)
            self._sentence_cache[cache_key] = dict(offline)
            return offline
        
        # Prepare Prompt
        items_str = ", ".join([f"{w['word']} ({w.get('tag', 'General')})" for w in word_data])
        prompt = (
            f"Write simple, child-friendly {language} sentences (3-6 words) for these words: {items_str}. "
            f"Use the context in brackets. Return ONLY valid JSON: {{'word': 'sentence'}}."
        )

        # Try API
        result = await self._execute_gemini(prompt, json_mode=True)
        
        if result is None or not isinstance(result, dict):
            # Silently fallback to offline mode
            offline = self._offline_sentences(word_data, language)
            self._sentence_cache[cache_key] = dict(offline)
            return offline

        normalized = {}
        for key, val in result.items():
            normalized[self._normalize_token(key)] = str(val).strip().strip('"').strip("'")

        resolved: Dict[str, str] = {}
        for item in word_data:
            word = str(item.get("word", "")).strip()
            if not word:
                continue
            direct = result.get(word) or result.get(word.lower())
            if direct:
                resolved[word] = str(direct).strip().strip('"').strip("'")
                continue
            norm = self._normalize_token(word)
            if norm in normalized:
                resolved[word] = normalized[norm]

        if len(resolved) < len(word_data):
            offline = self._offline_sentences(word_data, language)
            for word, sentence in offline.items():
                resolved.setdefault(word, sentence)

        self._sentence_cache[cache_key] = dict(resolved)
        return resolved

    async def generate_carrier_phrases(self, target_category: str, language: str) -> List[str]:
        if not self.api_key:
            return self._offline_carrier(language)
        
        cache_key = (target_category.lower(), language.lower())
        if cache_key in self._carrier_cache:
            return self._carrier_cache[cache_key]
        
        prompt = (
            f"Generate 3 different simple carrier phrase frames in {language} for '{target_category}' items. "
            f"Use '____' as placeholder. Keep them short. Return a valid JSON list of strings like [\"I see a ____.\", \"Find the ____.\"]"
        )
        
        result = await self._execute_gemini(prompt, json_mode=True)
        
        if result is None or not isinstance(result, list) or len(result) == 0:
            return self._offline_carrier(language)
        
        frames = [str(r).strip().replace('"', '') for r in result]
        self._carrier_cache[cache_key] = frames
        return frames

    # ==========================================================================
    # CORE API LOGIC
    # ==========================================================================
    async def _execute_gemini(self, prompt: str, json_mode: bool):
        try:
            url = f"{GEMINI_URL}?key={self.api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.4,
                    "responseMimeType": "application/json" if json_mode else "text/plain"
                }
            }
            resp = await self._client.post(url, json=payload, headers={'Content-Type': 'application/json'})
            
            if resp.status_code == 200:
                data = resp.json()
                try:
                    text = data['candidates'][0]['content']['parts'][0]['text']
                    return json.loads(text) if json_mode else text
                except:
                    return None
            elif resp.status_code == 429:
                return None 
            else:
                return None
        except Exception:
            return None

    # ==========================================================================
    # OFFLINE FALLBACKS (Smart, Diverse, POS-Aware)
    # ==========================================================================
    def _offline_sentences(self, word_data: List[Dict], language: str) -> dict:
        results = {}
        
        # English Templates - Categorized by Part of Speech
        en_noun_templates = [
            "I see a {word}.", "Look at the {word}.", "The {word} is here.",
            "Find the {word}.", "I like the {word}.", "This is a {word}.",
            "Where is the {word}?", "My {word} is big.", "The {word} is funny.",
            "He has a {word}.", "She saw a {word}.", "Touch the {word}."
        ]
        
        en_verb_templates = [
            "He likes to {word}.", "Can you {word}?", "Let's {word} now.",
            "I will {word}.", "Please {word} fast.", "She wants to {word}.",
            "We can {word} together.", "Do not {word}."
        ]
        
        en_adj_templates = [
            "It looks {word}.", "The car is {word}.", "I feel {word}.",
            "That is very {word}.", "Are you {word}?", "It tastes {word}."
        ]
        
        en_generic = ["Say the word {word}.", "{word} is the word."]

        # Urdu Templates (Romanized/Script)
        ur_noun_templates = [
            "Yeh {word} hai.", "{word} kahan hai?", "Mujhay {word} do.",
            "{word} dekho.", "Yeh {word} bara hai.", "{word} acha hai."
        ]
        
        ur_verb_templates = [
            "Chalo {word} karein.", "Main {word} sakta hoon.", "Usay {word} pasand hai."
        ]

        is_urdu = 'urdu' in language.lower()

        for w in word_data:
            word = w['word']
            pos = w.get('pos', 'Noun').lower()
            
            # Select appropriate template bank
            if is_urdu:
                if 'verb' in pos: t_list = ur_verb_templates
                else: t_list = ur_noun_templates
            else:
                if 'verb' in pos: t_list = en_verb_templates
                elif 'adj' in pos: t_list = en_adj_templates
                elif 'noun' in pos: t_list = en_noun_templates
                else: t_list = en_generic

            sent = random.choice(t_list).format(word=word)
            results[word] = sent
            
        return results

    def _offline_carrier(self, language: str) -> List[str]:
        if 'urdu' in language.lower():
            opts = ["Yeh ____ hai.", "____ dekho.", "Mujhay ____ do.", "____ kahan hai?"]
        else:
            opts = ["I see a ____.", "Look at the ____.", "I want the ____.", "Where is the ____?", "Find the ____."]
        random.shuffle(opts)
        return opts[:3]