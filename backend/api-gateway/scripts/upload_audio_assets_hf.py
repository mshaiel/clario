"""
One-time script to upload audio_assets/ to the Hugging Face dataset:
  junaiddbz/TTS_Audios

Uploads two folders separately so progress is visible:
  1. audio_assets/static_tts/    → static_tts/   in the HF repo
  2. audio_assets/sentence_banks/ → sentence_banks/ in the HF repo

Run from the project root:
  python scripts/upload_audio_assets_hf.py --token hf_YOUR_TOKEN_HERE

Or set HF_TOKEN env variable and run without --token:
  python scripts/upload_audio_assets_hf.py
"""
import argparse
import os
import sys

HF_REPO_ID = "junaiddbz/TTS_Audios"
HF_REPO_TYPE = "dataset"

UPLOADS = [
    {
        "local_folder": "audio_assets/static_tts",
        "repo_subfolder": "static_tts",
        "label": "Static TTS (263 files)",
    },
    {
        "local_folder": "audio_assets/sentence_banks",
        "repo_subfolder": "sentence_banks",
        "label": "Sentence Banks (~3,187 files)",
    },
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=None, help="HuggingFace write token (hf_...)")
    args = parser.parse_args()

    token = args.token or os.getenv("HF_TOKEN")
    if not token:
        print("ERROR: Provide your HF write token via --token or HF_TOKEN env variable.")
        sys.exit(1)

    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("ERROR: huggingface_hub not installed. Run: pip install huggingface_hub")
        sys.exit(1)

    api = HfApi(token=token)

    # Verify the repo exists and is accessible
    print(f"Verifying access to {HF_REPO_ID}...")
    try:
        api.repo_info(repo_id=HF_REPO_ID, repo_type=HF_REPO_TYPE)
        print(f"  Repo found: {HF_REPO_ID}\n")
    except Exception as e:
        print(f"ERROR: Cannot access repo {HF_REPO_ID}: {e}")
        print("Make sure the dataset repo exists at huggingface.co/datasets/junaiddbz/TTS_Audios")
        sys.exit(1)

    for upload in UPLOADS:
        local_folder = upload["local_folder"]
        repo_subfolder = upload["repo_subfolder"]
        label = upload["label"]

        if not os.path.exists(local_folder):
            print(f"SKIP: {local_folder} not found")
            continue

        print(f"Uploading {label}")
        print(f"  Local:  {local_folder}/")
        print(f"  Remote: {HF_REPO_ID}/{repo_subfolder}/")

        try:
            api.upload_folder(
                folder_path=local_folder,
                repo_id=HF_REPO_ID,
                repo_type=HF_REPO_TYPE,
                path_in_repo=repo_subfolder,
                commit_message=f"Upload {repo_subfolder}",
            )
            print(f"  Done.\n")
        except Exception as e:
            print(f"  ERROR: {e}\n")

    print("All uploads complete.")
    print(f"\nFiles are now accessible at:")
    print(f"  https://huggingface.co/datasets/{HF_REPO_ID}/tree/main")
    print(f"\nRaw file URL pattern:")
    print(f"  https://huggingface.co/datasets/{HF_REPO_ID}/resolve/main/{{path}}")
    print(f"\nExample:")
    print(f"  https://huggingface.co/datasets/{HF_REPO_ID}/resolve/main/static_tts/english/intro_blocks.wav")
    print(f"  https://huggingface.co/datasets/{HF_REPO_ID}/resolve/main/sentence_banks/english/blocks/sentence/en_blo_01.wav")


if __name__ == "__main__":
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(project_root)
    main()
