"""
Audio Asset Generation Script

Generates all 148 voice variation audio files per language using edge-tts with parallel synthesis.

Usage:
    python scripts/generate_audio_assets.py --language english
    python scripts/generate_audio_assets.py --language urdu
    python scripts/generate_audio_assets.py  # Generates both English and Urdu

Output:
    - audio_assets/{language}/*.mp3 - Generated audio files
    - audio_assets/manifest.json - Registry of all assets

Performance:
    ~40-50 seconds per language with 3-concurrent parallelization
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from typing import Dict, List, Any
import argparse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("GenerateAudioAssets")


# Define all voice variation text templates
VOICE_TEMPLATES = {
    "intro": [
        {
            "id": "intro_comprehensive",
            "text": "This is a Comprehensive Assessment. You'll read sentences that test all your speech sounds. Hold the microphone close to your mouth for the best results."
        },
        {
            "id": "intro_velar_fronting",
            "text": "This is the Velar Fronting Assessment. You'll practice K and G sounds. Please hold the microphone close to your mouth."
        },
        {
            "id": "intro_blocks",
            "text": "This is the Fluency Blocks Assessment. You'll practice smooth speech flow. Hold the mic close to capture any pauses or blocks."
        },
        {
            "id": "intro_repetition",
            "text": "This is the Repetition and Stuttering Assessment. You'll work on smooth word flow. Keep the microphone steady and close."
        },
        {
            "id": "intro_prolongation",
            "text": "This is the Prolongation Assessment. You'll practice steady sound production. Hold the mic steady throughout each sentence."
        },
        {
            "id": "intro_gliding",
            "text": "This is the R/W Gliding Assessment. You'll practice R and W sounds. Position the microphone close to your mouth."
        },
        {
            "id": "intro_stopping",
            "text": "This is the Stopping Assessment. You'll practice final consonant sounds. Hold the mic close so I can hear every sound clearly."
        },
        {
            "id": "intro_cluster_reduction",
            "text": "This is the Cluster Reduction Assessment. You'll practice consonant blends. Keep the microphone positioned near your mouth."
        }
    ],
    "waiting": [
        {"id": "waiting_001", "text": "Just a moment, I'm analyzing your speech..."},
        {"id": "waiting_002", "text": "Let me listen closely to that..."},
        {"id": "waiting_003", "text": "Analyzing your pronunciation..."},
        {"id": "waiting_004", "text": "I'm reviewing what you said..."},
        {"id": "waiting_005", "text": "One second, checking that for you..."},
        {"id": "waiting_006", "text": "Processing your speech..."},
        {"id": "waiting_007", "text": "Let me hear that again..."},
        {"id": "waiting_008", "text": "Analyzing your audio..."},
        {"id": "waiting_009", "text": "One moment please..."},
        {"id": "waiting_010", "text": "Give me a second to check that..."},
        {"id": "waiting_011", "text": "Checking the audio quality..."},
        {"id": "waiting_012", "text": "Reviewing your pronunciation..."},
        {"id": "waiting_013", "text": "Hold on, I'm listening..."},
        {"id": "waiting_014", "text": "Just analyzing the audio..."},
        {"id": "waiting_015", "text": "Let me process that..."},
        {"id": "waiting_016", "text": "Checking the quality..."},
        {"id": "waiting_017", "text": "Processing the audio file..."},
        {"id": "waiting_018", "text": "Examining the speech..."},
        {"id": "waiting_019", "text": "Analyzing the sounds..."},
        {"id": "waiting_020", "text": "One moment..."},
        {"id": "waiting_021", "text": "Let me review that..."},
        {"id": "waiting_022", "text": "Checking your speech..."},
        {"id": "waiting_023", "text": "Reviewing the audio..."},
        {"id": "waiting_024", "text": "Processing..."},
        {"id": "waiting_025", "text": "Just listening..."},
        {"id": "waiting_026", "text": "Analyzing..."},
        {"id": "waiting_027", "text": "Hold on..."},
        {"id": "waiting_028", "text": "Checking..."},
        {"id": "waiting_029", "text": "One second..."},
        {"id": "waiting_030", "text": "Let me check that..."},
        {"id": "waiting_031", "text": "I'm listening..."},
        {"id": "waiting_032", "text": "Reviewing..."},
        {"id": "waiting_033", "text": "Analyzing your audio..."},
        {"id": "waiting_034", "text": "Processing your speech..."},
        {"id": "waiting_035", "text": "Checking the results..."},
        {"id": "waiting_036", "text": "Evaluating your speech..."},
        {"id": "waiting_037", "text": "Computing the analysis..."},
        {"id": "waiting_038", "text": "Finalizing the check..."},
        {"id": "waiting_039", "text": "Just a brief moment..."},
        {"id": "waiting_040", "text": "Nearly done analyzing..."},
        {"id": "waiting_041", "text": "Wrapping up the analysis..."},
        {"id": "waiting_042", "text": "Final checks in progress..."},
        {"id": "waiting_043", "text": "Completing the analysis..."},
        {"id": "waiting_044", "text": "Just finishing up..."},
        {"id": "waiting_045", "text": "Almost there..."},
        {"id": "waiting_046", "text": "One more moment..."},
        {"id": "waiting_047", "text": "Hang tight..."},
        {"id": "waiting_048", "text": "Processing nearly complete..."},
        {"id": "waiting_049", "text": "Almost finished..."},
        {"id": "waiting_050", "text": "Should be done in a moment..."}
    ],
    "validation": {
        "good": [
            {"id": "val_good_001", "context": "good", "text": "Great job! That sounded very clear."},
            {"id": "val_good_002", "context": "good", "text": "Excellent pronunciation!"},
            {"id": "val_good_003", "context": "good", "text": "That was good. Keep it up!"},
            {"id": "val_good_004", "context": "good", "text": "Nice work on that one!"},
            {"id": "val_good_005", "context": "good", "text": "Very clear! Well done!"},
            {"id": "val_good_006", "context": "good", "text": "That was excellent!"},
            {"id": "val_good_007", "context": "good", "text": "Wonderful pronunciation!"},
            {"id": "val_good_008", "context": "good", "text": "Really good effort!"},
            {"id": "val_good_009", "context": "good", "text": "Sounds great!"},
            {"id": "val_good_010", "context": "good", "text": "Perfect clarity!"},
            {"id": "val_good_011", "context": "good", "text": "You nailed that one!"},
            {"id": "val_good_012", "context": "good", "text": "Excellent work!"},
            {"id": "val_good_013", "context": "good", "text": "That was very good!"},
            {"id": "val_good_014", "context": "good", "text": "Fantastic effort!"},
            {"id": "val_good_015", "context": "good", "text": "I could hear that perfectly!"},
            {"id": "val_good_016", "context": "good", "text": "Superb pronunciation!"},
            {"id": "val_good_017", "context": "good", "text": "That sounds right!"},
            {"id": "val_good_018", "context": "good", "text": "Well articulated!"},
            {"id": "val_good_019", "context": "good", "text": "Very nice work!"},
            {"id": "val_good_020", "context": "good", "text": "Excellent effort!"}
        ],
        "needs_work": [
            {"id": "val_work_001", "context": "needs_work", "text": "That one was a bit unclear. Try again?"},
            {"id": "val_work_002", "context": "needs_work", "text": "Let's try that one more time."},
            {"id": "val_work_003", "context": "needs_work", "text": "I heard some sounds that need work. Want to try again?"},
            {"id": "val_work_004", "context": "needs_work", "text": "Good effort! Let's practice that one more."},
            {"id": "val_work_005", "context": "needs_work", "text": "Close, but let's try again."},
            {"id": "val_work_006", "context": "needs_work", "text": "That could be clearer. Want another go?"},
            {"id": "val_work_007", "context": "needs_work", "text": "Good try! Let's work on that sound more."},
            {"id": "val_work_008", "context": "needs_work", "text": "Not quite. Let's try that again."},
            {"id": "val_work_009", "context": "needs_work", "text": "I think we can do better. Want to try once more?"},
            {"id": "val_work_010", "context": "needs_work", "text": "Let me do that one again. Let's try it together."},
            {"id": "val_work_011", "context": "needs_work", "text": "That needs a bit more work. Shall we try again?"},
            {"id": "val_work_012", "context": "needs_work", "text": "Almost there! Let's give it another try."},
            {"id": "val_work_013", "context": "needs_work", "text": "Let's focus on that sound more. Try again?"},
            {"id": "val_work_014", "context": "needs_work", "text": "That's a good start. Let's try once more."},
            {"id": "val_work_015", "context": "needs_work", "text": "I heard some issues. Can you try again?"},
            {"id": "val_work_016", "context": "needs_work", "text": "Let's work on the clarity. Try that again?"},
            {"id": "val_work_017", "context": "needs_work", "text": "Not quite right. Let's try it once more."},
            {"id": "val_work_018", "context": "needs_work", "text": "Let's give that another shot."},
            {"id": "val_work_019", "context": "needs_work", "text": "That needs some improvement. Want to try again?"},
            {"id": "val_work_020", "context": "needs_work", "text": "Let's practice that one more time."}
        ],
        "perfect": [
            {"id": "val_perf_001", "context": "perfect", "text": "Perfect! Couldn't have said it better!"},
            {"id": "val_perf_002", "context": "perfect", "text": "Flawless! Excellent work!"},
            {"id": "val_perf_003", "context": "perfect", "text": "Outstanding! That was perfect!"},
            {"id": "val_perf_004", "context": "perfect", "text": "That's exactly right!"},
            {"id": "val_perf_005", "context": "perfect", "text": "Absolutely perfect!"},
            {"id": "val_perf_006", "context": "perfect", "text": "Couldn't be better!"},
            {"id": "val_perf_007", "context": "perfect", "text": "That's ideal!"},
            {"id": "val_perf_008", "context": "perfect", "text": "Absolutely beautiful!"},
            {"id": "val_perf_009", "context": "perfect", "text": "That was impeccable!"},
            {"id": "val_perf_010", "context": "perfect", "text": "Perfect pronunciation!"},
            {"id": "val_perf_011", "context": "perfect", "text": "That's spot on!"},
            {"id": "val_perf_012", "context": "perfect", "text": "You've got it!"},
            {"id": "val_perf_013", "context": "perfect", "text": "Absolutely right!"},
            {"id": "val_perf_014", "context": "perfect", "text": "That's just right!"},
            {"id": "val_perf_015", "context": "perfect", "text": "Couldn't ask for better!"},
            {"id": "val_perf_016", "context": "perfect", "text": "That's the way to do it!"},
            {"id": "val_perf_017", "context": "perfect", "text": "Perfect every way!"},
            {"id": "val_perf_018", "context": "perfect", "text": "Absolutely flawless!"},
            {"id": "val_perf_019", "context": "perfect", "text": "That's masterful!"},
            {"id": "val_perf_020", "context": "perfect", "text": "Perfect production!"}
        ]
    },
    "transition": [
        {"id": "trans_001", "text": "Ready for the next sentence?"},
        {"id": "trans_002", "text": "Let's try the next one."},
        {"id": "trans_003", "text": "Moving on to the next sentence..."},
        {"id": "trans_004", "text": "Here's the next one for you."},
        {"id": "trans_005", "text": "Let's continue."},
        {"id": "trans_006", "text": "Alright, next sentence coming up."},
        {"id": "trans_007", "text": "Ready for more?"},
        {"id": "trans_008", "text": "Moving to the next challenge."},
        {"id": "trans_009", "text": "Ready? Here's the next one."},
        {"id": "trans_010", "text": "Let's go to the next sentence."},
        {"id": "trans_011", "text": "One more coming up."},
        {"id": "trans_012", "text": "Next sentence, please."},
        {"id": "trans_013", "text": "Let's move forward."},
        {"id": "trans_014", "text": "Ready to continue?"},
        {"id": "trans_015", "text": "Here comes the next one."},
        {"id": "trans_016", "text": "On to the next..."},
        {"id": "trans_017", "text": "Shall we continue?"},
        {"id": "trans_018", "text": "Next challenge..."},
        {"id": "trans_019", "text": "Ready to proceed?"},
        {"id": "trans_020", "text": "Let's keep going."}
    ],
    "completion": [
        {"id": "comp_001", "text": "Great job! You've completed the assessment. I'll review your results now."},
        {"id": "comp_002", "text": "Well done! Let me analyze your results."},
        {"id": "comp_003", "text": "Excellent work! That's the end of this assessment."},
        {"id": "comp_004", "text": "You did great! Let me process your results."},
        {"id": "comp_005", "text": "Fantastic effort! I'm reviewing your assessment now."},
        {"id": "comp_006", "text": "You've completed the assessment! Let me compile your results."},
        {"id": "comp_007", "text": "Superb work! Your assessment is complete."},
        {"id": "comp_008", "text": "Wonderful! I'm analyzing your performance."},
        {"id": "comp_009", "text": "You made it through! Let me check your results."},
        {"id": "comp_010", "text": "Assessment complete! I'm preparing your summary."}
    ]
}


async def generate_voice_files(language: str = "english", max_parallel: int = 3) -> Dict[str, bytes]:
    """
    Generate audio files for all voice variations in parallel.

    Args:
        language: Target language ("english" or "urdu")
        max_parallel: Max concurrent TTS requests (respects edge-tts rate limits)

    Returns:
        Dict mapping variation_id → audio_bytes
    """
    from services.tts_service import TTSService

    results = {}
    semaphore = asyncio.Semaphore(max_parallel)

    async def synthesize_with_limit(var_id: str, text: str):
        """Synthesize one variation with rate limiting"""
        async with semaphore:
            try:
                audio_bytes = await TTSService.synthesize_to_bytes(
                    text=text,
                    lang=language,
                    gender="female"  # Consistent voice
                )

                if audio_bytes:
                    results[var_id] = audio_bytes
                    logger.info(f"✅ Synthesized {var_id}")
                else:
                    logger.warning(f"⚠️ Synthesis returned None for {var_id}")

            except Exception as e:
                logger.error(f"❌ Synthesis failed for {var_id}: {e}")

    # Flatten all variations into tasks
    tasks = []

    for category, variations in VOICE_TEMPLATES.items():
        if category == "validation":
            # Handle validation subcategories
            for context, items in variations.items():
                for var in items:
                    var_id = f"validation_{context}_{var['id']}"
                    text = var["text"]
                    tasks.append(synthesize_with_limit(var_id, text))
        else:
            # Handle other categories
            for var in variations:
                var_id = f"{category}_{var['id']}"
                text = var["text"]
                tasks.append(synthesize_with_limit(var_id, text))

    # Execute all in parallel with rate limiting
    logger.info(f"🎵 Synthesizing {len(tasks)} voice variations for {language}...")
    start_time = datetime.now()

    await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = (datetime.now() - start_time).total_seconds()
    logger.info(f"✅ Generated {len(results)}/{len(tasks)} voice variations in {elapsed:.1f}s")

    return results


async def save_voice_files(audio_dict: Dict[str, bytes], language: str = "english") -> bool:
    """
    Save synthesized audio files to disk.

    Args:
        audio_dict: Dict of var_id → audio_bytes
        language: Target language

    Returns:
        True if all saved successfully, False otherwise
    """
    output_dir = f"audio_assets/{language}"
    os.makedirs(output_dir, exist_ok=True)

    success_count = 0

    for var_id, audio_bytes in audio_dict.items():
        try:
            # Map var_id to filename
            # var_id format: "category_type_id" or "validation_context_id"
            parts = var_id.split("_", 1)  # Split on first underscore

            # Extract file name from templates
            file_name = None

            for category, variations in VOICE_TEMPLATES.items():
                if category == "validation":
                    for context, items in variations.items():
                        for item in items:
                            if var_id == f"validation_{context}_{item['id']}":
                                file_name = f"validation_{context}_{item['id']}.mp3"
                else:
                    for item in variations:
                        if var_id == f"{category}_{item['id']}":
                            file_name = f"{item['id']}.mp3"

            if not file_name:
                logger.warning(f"⚠️ Could not map {var_id} to filename")
                continue

            filepath = os.path.join(output_dir, file_name)

            with open(filepath, 'wb') as f:
                f.write(audio_bytes)

            success_count += 1
            logger.info(f"💾 Saved {file_name} ({len(audio_bytes)} bytes)")

        except Exception as e:
            logger.error(f"❌ Error saving {var_id}: {e}")

    logger.info(f"📁 Saved {success_count}/{len(audio_dict)} files to {output_dir}")
    return success_count == len(audio_dict)


def generate_manifest(language: str = "english") -> Dict:
    """
    Generate manifest.json structure from templates.

    Args:
        language: Target language

    Returns:
        Dict with complete manifest structure
    """
    manifest = {
        "version": "1.0.0",
        "generated_at": datetime.now().isoformat(),
        language: {
            "intro": [],
            "waiting": [],
            "validation": {"good": [], "needs_work": [], "perfect": []},
            "transition": [],
            "completion": []
        }
    }

    # Add intro items
    for item in VOICE_TEMPLATES["intro"]:
        manifest[language]["intro"].append({
            "id": item["id"],
            "file": f"{item['id']}.mp3",
            "text": item["text"],
            "test_types": [item["id"].replace("intro_", "")]
        })

    # Add waiting items
    for item in VOICE_TEMPLATES["waiting"]:
        manifest[language]["waiting"].append({
            "id": item["id"],
            "file": f"{item['id']}.mp3",
            "text": item["text"]
        })

    # Add validation items
    for context, items in VOICE_TEMPLATES["validation"].items():
        for item in items:
            manifest[language]["validation"][context].append({
                "id": item["id"],
                "file": f"validation_{context}_{item['id']}.mp3",
                "context": context,
                "text": item["text"]
            })

    # Add transition items
    for item in VOICE_TEMPLATES["transition"]:
        manifest[language]["transition"].append({
            "id": item["id"],
            "file": f"{item['id']}.mp3",
            "text": item["text"]
        })

    # Add completion items
    for item in VOICE_TEMPLATES["completion"]:
        manifest[language]["completion"].append({
            "id": item["id"],
            "file": f"{item['id']}.mp3",
            "text": item["text"]
        })

    return manifest


def save_manifest(manifest: Dict) -> bool:
    """
    Save manifest to audio_assets/manifest.json.

    Args:
        manifest: Manifest dict

    Returns:
        True if saved successfully, False otherwise
    """
    os.makedirs("audio_assets", exist_ok=True)

    try:
        filepath = "audio_assets/manifest.json"
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

        logger.info(f"✅ Saved manifest to {filepath}")
        return True

    except Exception as e:
        logger.error(f"❌ Error saving manifest: {e}")
        return False


async def generate_language(language: str) -> bool:
    """
    Complete pipeline: Generate + save voice files + create manifest for one language.

    Args:
        language: "english" or "urdu"

    Returns:
        True if successful, False otherwise
    """
    logger.info(f"\n{'='*60}")
    logger.info(f"🎤 Starting voice pack generation for {language.upper()}")
    logger.info(f"{'='*60}\n")

    # 1. Synthesize all variations
    audio_dict = await generate_voice_files(language)

    if not audio_dict:
        logger.error(f"❌ No audio generated for {language}")
        return False

    # 2. Save files to disk
    if not await save_voice_files(audio_dict, language):
        logger.error(f"❌ Failed to save voice files for {language}")
        return False

    # 3. Generate manifest
    manifest = generate_manifest(language)

    # 4. Save manifest (only for the first language, or merge if already exists)
    if not save_manifest(manifest):
        logger.error(f"❌ Failed to save manifest for {language}")
        return False

    logger.info(f"✅ Voice pack complete for {language}\n")
    return True


async def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Generate audio assets for UAB")
    parser.add_argument(
        "--language",
        choices=["english", "urdu", "all"],
        default="all",
        help="Language to generate (default: all)"
    )

    args = parser.parse_args()

    languages = ["english", "urdu"] if args.language == "all" else [args.language]

    success = True
    for language in languages:
        if not await generate_language(language):
            success = False

    if success:
        logger.info(f"✅ All voice packs generated successfully!")
        sys.exit(0)
    else:
        logger.error(f"❌ Some voice packs failed to generate")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
