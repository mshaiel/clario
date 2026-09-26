import os
import sys

# Ensure module root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.acg.db import LexiconMiner

miner = LexiconMiner()

target_pankratz = {
    'word': 'pankratz',
    'clean_ipa': 'p æ ŋ k r ə t s',
    'ipa': 'p æ ŋ k r ə t s',
    'syllables': 2,
    'structure': 'Complex',
    'final_phoneme': 's'
}

print("\nTesting Pankratz vs 'n':")
res = miner.fetch_minimal_pair_foil(target_pankratz, 'n', 'english', difficulty=1)
print(res)

target_cat = {
    'word': 'cat',
    'clean_ipa': 'k æ t',
    'ipa': 'k æ t',
    'syllables': 1,
    'structure': 'CVC',
    'final_phoneme': 't'
}

print("\nTesting Cat vs 't':")
res = miner.fetch_minimal_pair_foil(target_cat, 't', 'english', difficulty=1)
print(res)

