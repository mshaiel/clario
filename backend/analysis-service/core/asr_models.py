import logging
import os
import torch
from typing import List, Dict, Any, Optional
from core.config import GLOBAL_CONFIG

# NEW: Transformers imports for the Facebook Model
from transformers import Wav2Vec2ForCTC, Wav2Vec2CTCTokenizer, Wav2Vec2FeatureExtractor, Wav2Vec2Processor
import librosa

logger = logging.getLogger("ASRModelLoader")

class ASRModelLoader:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ASRModelLoader, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        
        self.config = GLOBAL_CONFIG.asr
        self.whisper_model = None
        self.allosaurus_model = None
        
        # NEW: Wav2Vec2 Components
        self.w2v_processor = None
        self.w2v_model = None
        
        self._initialized = True

    def load_models(self):
        """
        Loads models into memory. MUST be called on App Startup.
        """
        logger.info("🚀 Loading ASR Models...")
        self._log_dependency_versions()
        
        # 1. Load Whisper (Words & Transcripts)
        if not self.whisper_model:
            try:
                self._load_whisper()
            except Exception as e:
                logger.warning(f"⚠️ Whisper load failed: {e}")

        # 2. Load Allosaurus (Timestamps & Fluency)
        if not self.allosaurus_model:
            try:
                self._load_allosaurus()
            except Exception as e:
                logger.warning(f"⚠️ Allosaurus load failed: {e}")

        # 3. Load Wav2Vec2 (High-Accuracy Phonology) [NEW]
        if not self.w2v_model:
            try:
                self._load_wav2vec()
            except Exception as e:
                logger.warning(f"⚠️ Wav2Vec2 load failed: {e}")
            
        logger.info("✅ ASR Models Load Process Complete.")

    def _log_dependency_versions(self):
        """Helper to debug environment issues."""
        try:
            import faster_whisper
            logger.info(f"   - Faster-Whisper found")
        except: logger.info("   - Faster-Whisper not found")

    def _load_whisper(self):
        from faster_whisper import WhisperModel
        model_path = self.config.whisper_path or self.config.model_size
        logger.info(f"Loading Whisper: {model_path} (Device: {self.config.device})")
        
        self.whisper_model = WhisperModel(
            model_path, 
            device=self.config.device, 
            compute_type=self.config.compute_type
        )

    def _load_allosaurus(self):
        from allosaurus.app import read_recognizer
        logger.info("Loading Allosaurus...")
        self.allosaurus_model = read_recognizer()

    def _load_wav2vec(self):
        """
        Loads the Facebook SOTA model for Phonology.
        This provides high-accuracy IPA output for SODA analysis.
        """
        model_id = self.config.wav2vec2_model_id
        logger.info(f"Loading Wav2Vec2: {model_id}...")
        
        try:
            # Robust loading: Re-assemble processor to bypass potential tokenizer config issues
            tokenizer = Wav2Vec2CTCTokenizer.from_pretrained(model_id)
            feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(model_id)
            self.w2v_processor = Wav2Vec2Processor(feature_extractor=feature_extractor, tokenizer=tokenizer)
            
            self.w2v_model = Wav2Vec2ForCTC.from_pretrained(model_id)
            
            # Use GPU if available
            if self.config.device == "cuda" and torch.cuda.is_available():
                self.w2v_model.to("cuda")
                logger.info("   -> Wav2Vec2 pushed to GPU")
        except Exception as e:
             logger.error(f"❌ Failed to load Wav2Vec2 model: {e}")
             raise e

    def transcribe_words(self, audio_path: str, use_phonology_settings: bool = False, prompt: Optional[str] = None, language: str = "english") -> List[Dict[str, Any]]:
        """
        Transcribes audio to words using Whisper.
        Includes ROBUST Fallback logic for when timestamp alignment fails.
        """
        if not self.whisper_model:
            raise RuntimeError("Whisper model is not loaded. Cannot transcribe.")
        
        # 1. Determine Language Code (en/ur)
        whisper_lang = self.config.lang_map.get(language, "en")
        
        # 2. Configure Beam Size
        beam = self.config.beam_size_phonology if use_phonology_settings else self.config.beam_size
        
        logger.info(f"🎤 Transcribing ({language} -> {whisper_lang}) with beam={beam}...")
        
        # 3. Transcribe
        segments, _ = self.whisper_model.transcribe(
            audio_path, 
            word_timestamps=True,
            beam_size=beam,
            language=whisper_lang, 
            task="transcribe",
            initial_prompt=prompt 
        )
        
        # 4. Process Results (With Debug Logging)
        words = []
        seg_count = 0
        
        for seg in segments:
            seg_count += 1
            has_words = seg.words is not None and len(seg.words) > 0
            has_text = seg.text is not None and len(seg.text.strip()) > 0
            
            # Plan A: Use precise word timestamps (Preferred)
            if has_words:
                logger.info(f"   [Seg {seg_count}] Plan A (Precise): '{seg.text}'")
                for w in seg.words:
                    words.append({
                        "word": w.word.strip().lower(),
                        "start": w.start,
                        "end": w.end,
                        "confidence": w.probability
                    })
            
            # Plan B: Fallback to segment text (If alignment failed)
            elif has_text:
                logger.warning(f"   [Seg {seg_count}] Plan B (Fallback): '{seg.text}' (Alignment failed)")
                
                # Split text into rough words
                fake_words = seg.text.strip().split()
                if not fake_words: continue
                
                # Estimate timing (distribute duration equally)
                seg_duration = seg.end - seg.start
                word_dur = seg_duration / len(fake_words)
                
                for i, w_text in enumerate(fake_words):
                    words.append({
                        "word": w_text.strip().lower(),
                        "start": seg.start + (i * word_dur),
                        "end": seg.start + ((i+1) * word_dur),
                        "confidence": 0.5  # Lower confidence for fallback
                    })
            else:
                logger.warning(f"   [Seg {seg_count}] Plan C (Empty): Segment discarded.")

        logger.info(f"✅ Total Extracted Words: {len(words)}")
        return words

    def recognize_phones(self, audio_path: str, need_accurate_timing: bool = False, language: str = "english") -> List[Dict[str, Any]]:
        """
        Smart Switching Logic:
        ----------------------
        1. If need_accurate_timing=True (e.g. Blocks Test):
           -> Use ALLOSAURUS (Best for timing/timestamps)
           
        2. If need_accurate_timing=False (e.g. Gliding/SODA Tests):
           -> Use WAV2VEC2 (Best for phonetic accuracy)
        """
        
        # CASE A: Precision Timing Needed (Fluency/Blocks)
        if need_accurate_timing:
            if not self.allosaurus_model:
                 logger.error("Allosaurus needed for timing but not loaded.")
                 return []
            return self._run_allosaurus(audio_path, language, accurate=True)

        # CASE B: Phonetic Accuracy Needed (SODA/Phonology)
        if self.w2v_model:
            try:
                return self._run_wav2vec(audio_path)
            except Exception as e:
                logger.error(f"Wav2Vec2 failed: {e}, falling back to Allosaurus")
        
        # Fallback to Allosaurus if Wav2Vec2 fails or isn't loaded
        return self._run_allosaurus(audio_path, language, accurate=False)

    def _run_wav2vec(self, audio_path: str) -> List[Dict[str, Any]]:
        """Run inference using Facebook Wav2Vec2 (SOTA IPA)"""
        import librosa
        
        # 1. Load Audio
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)
        
        # 2. Prepare Inputs
        inputs = self.w2v_processor(audio, sampling_rate=16000, return_tensors="pt").input_values
        if self.config.device == "cuda" and torch.cuda.is_available():
            inputs = inputs.to("cuda")

        # 3. Inference
        with torch.no_grad():
            logits = self.w2v_model(inputs).logits

        # 4. Decode to IPA
        predicted_ids = torch.argmax(logits, dim=-1)
        transcription = self.w2v_processor.batch_decode(predicted_ids)[0]
        
        logger.info(f"🐛 Wav2Vec2 Raw Output: '{transcription}'")

        # ════════════════════════════════════════════════════════════════════
        # FIX START: Robust Tokenization for Continuous Strings
        # ════════════════════════════════════════════════════════════════════
        clean_phones = []
        if "|" in transcription:
             # Case A: Model uses pipes (common in Facebook models)
             clean_phones = transcription.replace("|", " ").split(" ")
        elif " " in transcription:
             # Case B: Model uses spaces
             clean_phones = transcription.split(" ")
        else:
             # Case C: CONTINUOUS STRING (Your current issue)
             # The model output 'meɾɐdostaa'. We must split this by character.
             clean_phones = list(transcription)

        # Clean up empty strings and whitespace
        clean_phones = [p.strip() for p in clean_phones if p.strip()]
        # ════════════════════════════════════════════════════════════════════
        
        logger.info(f"🐛 Cleaned Phones for SODA: {clean_phones}")

        # 5. Format as list of objects
        phones = []
        duration_per_phone = (len(audio)/sr) / max(1, len(clean_phones))

        for i, p in enumerate(clean_phones):
            phones.append({
                "phone": p,
                "start": i * duration_per_phone,
                "end": (i+1) * duration_per_phone,
                "duration": duration_per_phone
            })
            
        return phones

    def _run_allosaurus(self, audio_path: str, language: str, accurate: bool) -> List[Dict[str, Any]]:
        """Run inference using Allosaurus (Universal/English map)"""
        if not self.allosaurus_model: return []
        
        # Force 'eng' model for Urdu to avoid hallucinations (The "English Hack")
        # unless user strictly wants 'urd' (not recommended based on tests)
        lang_id = self.config.allosaurus_map.get(language, "eng")
        
        wav_path = None
        try:
            wav_path = self._ensure_wav_format(audio_path)
            logger.info(f"🎯 Getting phones via Allosaurus (ID: {lang_id})...")
            
            if accurate:
                # Mode 1: Timestamp-Heavy (Slow, Precise)
                raw_output = self.allosaurus_model.recognize(wav_path, lang_id=lang_id, timestamp=True)
                phones = []
                for line in raw_output.splitlines():
                    parts = line.split()
                    if len(parts) >= 3:
                        phones.append({
                            "phone": parts[2],
                            "start": float(parts[0]),
                            "end": float(parts[0]) + float(parts[1]),
                            "duration": float(parts[1])
                        })
                return phones
            else:
                # Mode 2: Hybrid/Fast
                raw_output = self.allosaurus_model.recognize(wav_path, lang_id=lang_id, timestamp=False)
                heard_phones = raw_output.split()
                
                # Estimate timing
                y, sr = librosa.load(wav_path, sr=16000)
                total_duration = len(y) / sr
                
                phones = []
                if heard_phones:
                    avg_duration = total_duration / len(heard_phones)
                    for i, phone in enumerate(heard_phones):
                        start = i * avg_duration
                        phones.append({
                            "phone": phone,
                            "start": start,
                            "end": start + avg_duration,
                            "duration": avg_duration
                        })
                return phones
                
        except Exception as e:
            logger.error(f"❌ Allosaurus ({lang_id}) failed: {e}")
            return []
        finally:
            if wav_path and wav_path != audio_path and os.path.exists(wav_path):
                try: os.remove(wav_path)
                except: pass

    def _ensure_wav_format(self, audio_path: str) -> str:
        if audio_path.lower().endswith('.wav'): return audio_path
        try:
            from core.utils_audio import load_audio, create_temp_audio_file
            import soundfile as sf
            audio, sr = load_audio(audio_path, target_sr=16000, mono=True)
            temp_wav = create_temp_audio_file(suffix='_allosaurus.wav')
            sf.write(temp_wav, audio, sr, format='WAV', subtype='PCM_16')
            return temp_wav
        except Exception as e:
            raise RuntimeError(f"Could not convert to WAV: {e}")

def get_asr_loader() -> ASRModelLoader:
    return ASRModelLoader()