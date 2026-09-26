import numpy as np
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("AlignmentCore")

# ─── 1. UNIVERSAL PHONE GROUPS (IPA BASED) ─────────────────────────────
# Normalized IPA groups covering English and Urdu.
PHONE_GROUPS = {
    'VOWEL':  [
        'ə', 'ʌ', 'a', 'ɑ', 'ɑː', 'ɒ', 'æ', 'i', 'ɪ', 'e', 'ɛ', 'y', 'u', 'ʊ', 'o', 'ɔ', 
        'aɪ', 'eɪ', 'oʊ', 'aʊ', 'ɔɪ', 'ɯ', 'æʊ', 'ɛə', 'ɪə', 'ʊə',
        'aː', 'iː', 'uː', 'oː', 'eː', 'ɔː', 'ɛː', 'ʊː', 'ɪː',
        'ã', 'õ', 'ũ', 'ĩ', 'ẽ', 'ɑ̃', 'ʊ̃', 'ɪ̃', 'ɛ̃', 'õ', 'ũ'
    ],
    'STOP_T': ['t', 'd', 'tʰ', 'dʰ', 'ʈ', 'ɖ', 't̪', 'd̪', 't̪ʰ', 'd̪ʱ'], 
    'STOP_K': ['k', 'ɡ', 'g', 'q', 'kʰ', 'ɡʰ', 'x', 'ɣ', 'χ', 'ʁ'],             
    'STOP_P': ['p', 'b', 'pʰ', 'bʰ', 'bʱ'],
    'TH_SOUND': ['ð', 'θ', 'ð̪'],
    'SIBIL_S':  ['s', 'z', 'ʂ', 'ʐ', 'ɕ', 'ṣ', 'ẓ', 'sˤ', 'zː'],
    'SIBIL_SH': ['ʃ', 'ʒ'],
    'FRIC':     ['f', 'v', 'ɸ', 'β', 'h', 'ɦ', 'ħ'], 
    'AFFRICATE': ['tʃ', 'dʒ', 't͡ʃ', 'd͡ʒ', 'c', 'ɟ', 't͡ʃʰ', 'd͡ʒʰ', 'ʤ', 'ʧ'],
    'NASAL':  ['m', 'n', 'ŋ', 'ɳ', 'ɲ', 'ɴ', 'n̪', 'nə', '̃'],
    'LIQUID': ['l', 'r', 'ɹ', 'ɫ', 'ɭ', 'ɾ', 'ɽ', 'rʰ'],
    'GLIDE':  ['j', 'w', 'ʋ', 'u̯', 'i̯']
}

_PHONE_TO_CLASS: Dict[str, str] = {
    phone: cls
    for cls, phones in PHONE_GROUPS.items()
    for phone in phones
}


# ─── 2. LENIENCY FILTERS ───────────────────────────────────────────────

WEAK_ENDINGS = {'p', 'b', 't', 'd', 'm', 'n', 'ŋ', 'v', 'f', 'ɹ', 'l', 'r', 'ɾ', 'h'}
HARD_TO_HEAR = {'h', 'ð', 'θ', 'ː', '̃', '̪'} # Added dental marker to hard-to-hear
IGNORED_ADDITION_CONSONANTS = {
    'h', 'ɦ', 'ɡ', 'k', 'kʰ', 'ɹ', 'r', 'n', 'm', 'ŋ', 
    't', 'd', 'tʰ', 'p', 'b', 'pʰ', 's', 'z', 'ð', 'f'
}

# ─── 3. HELPER FUNCTIONS ───────────────────────────────────────────────

def normalize_phone(p: str) -> str:
    # Handle common unicode homoglyphs and IPA variations
    p = p.replace('ː', '').replace('̃', '').replace('̪', '').strip()
    mapping = {
        'g': 'ɡ',
        'r': 'ɹ',
        'a': 'ɑ'
    }
    return mapping.get(p, p)

def get_phone_class(p: str, language: str = "english") -> str:
    cls = _PHONE_TO_CLASS.get(p)
    if cls: return cls
    
    clean_p = normalize_phone(p)
    cls = _PHONE_TO_CLASS.get(clean_p)
    if cls: return cls
    
    if any(v in p for v in ['a', 'i', 'u', 'e', 'o']): return "VOWEL"
    return clean_p

def are_phones_similar(p1: str, p2: str, language: str = "english") -> bool:
    if p1 == p2: return True
    
    # Strip length/diacritics and normalize homoglyphs for comparison
    base_p1 = normalize_phone(p1)
    base_p2 = normalize_phone(p2)
    if base_p1 == base_p2: return True
    
    c1 = get_phone_class(p1)
    c2 = get_phone_class(p2)
    
    if c1 == c2: return True
    
    # Cross-class similarities
    if p1 in {'v', 'w', 'ʋ'} and p2 in {'v', 'w', 'ʋ'}: return True
    if p1 in {'s', 'z'} and p2 in {'s', 'z'}: return True
    if p1 in {'l', 'r', 'ɾ', 'ɹ'} and p2 in {'l', 'r', 'ɾ', 'ɹ'}: return True
    
    return False

def is_stutter_variant(p1: str, p2: str, language: str = "english") -> bool:
    return are_phones_similar(p1, p2, language)

# ─── 4. ALIGNMENT (Semi-Global / Word Spotting) ──────────────────────

def get_optimal_alignment(exp_data: List[Dict], heard_phones: List[str], language: str = "english") -> tuple:
    """
    Performs Semi-Global Alignment with "Zero-Cost Skips" for modifiers.
    """
    n = len(exp_data)
    m = len(heard_phones)
    
    # 🔧 SCORING WEIGHTS
    MATCH_SCORE = 3       
    SIMILAR_SCORE = 1     
    MISMATCH_SCORE = -2   
    GAP_SCORE = -2        
    
    # 🔧 OPTIONAL CHARS (Cost 0 to skip)
    # If these are expected but missing, we don't penalize.
    OPTIONAL_CHARS = {'ː', '̪', 'ʰ', 'ʱ', '̃'}

    score_matrix = np.zeros((n + 1, m + 1))

    # 1. Initialization
    penalty = 0
    score_matrix[0][0] = 0
    for i in range(1, n + 1): 
        p_char = exp_data[i-1]['phone']
        penalty += 0 if p_char in OPTIONAL_CHARS else GAP_SCORE
        score_matrix[i][0] = penalty
        
    # Free start (Horizontal) - No penalty for starting late in the sentence
    for j in range(m + 1): 
        score_matrix[0][j] = 0

    # 2. Fill Matrix
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            p1 = exp_data[i-1]['phone']
            p2 = heard_phones[j-1]
            
            # Determine Match Score
            if p1 == p2: 
                s = MATCH_SCORE
            elif are_phones_similar(p1, p2, language): 
                s = SIMILAR_SCORE
            else: 
                s = MISMATCH_SCORE
            
            # Determine Vertical Gap Penalty (Omission)
            # If p1 is a length marker/diacritic, skipping it is FREE.
            omission_cost = 0 if p1 in OPTIONAL_CHARS else GAP_SCORE
            
            score_matrix[i][j] = max(
                score_matrix[i-1][j-1] + s,             # Diagonal
                score_matrix[i-1][j] + omission_cost,   # Vertical (Omission)
                score_matrix[i][j-1] + GAP_SCORE        # Horizontal (Addition)
            )
            
    # 3. Traceback
    # Find best end point in the heard sequence (Word Spotting)
    best_end_j = int(np.argmax(score_matrix[n]))
    
    # 🛡️ Safety Check: Reduced Strictness
    # Calculate a "theoretical max" excluding optional chars to be fair
    req_chars = sum(1 for x in exp_data if x['phone'] not in OPTIONAL_CHARS)
    fair_max_score = max(1, req_chars * MATCH_SCORE)
    actual_score = score_matrix[n][best_end_j]
    
    # Alignment confidence scaled to [0, 1]
    alignment_confidence = max(0.0, min(1.0, actual_score / fair_max_score))

    # Lower threshold to 20% to account for short words in long sentences
    if actual_score < (fair_max_score * 0.20):
        logger.warning(f"⚠️ Poor alignment confidence ({actual_score:.1f}/{fair_max_score}). Word likely not said.")
        return exp_data, [None] * n, alignment_confidence

    # Traceback Logic
    align_exp, align_heard = [], []
    i, j = n, best_end_j

    while i > 0 and j > 0:
        p1 = exp_data[i-1]['phone']
        p2 = heard_phones[j-1]
        
        # Recalculate costs to decide path
        if p1 == p2: s = MATCH_SCORE
        elif are_phones_similar(p1, p2, language): s = SIMILAR_SCORE
        else: s = MISMATCH_SCORE
        
        omission_cost = 0 if p1 in OPTIONAL_CHARS else GAP_SCORE
        
        current = score_matrix[i][j]
        
        # Check Diagonals (using float epsilon for safety)
        if abs(current - (score_matrix[i-1][j-1] + s)) < 0.001:
            align_exp.append(exp_data[i-1])
            align_heard.append(p2)
            i -= 1; j -= 1
        elif abs(current - (score_matrix[i-1][j] + omission_cost)) < 0.001:
            align_exp.append(exp_data[i-1])
            align_heard.append(None) # Omission
            i -= 1
        else:
            align_exp.append(None)
            align_heard.append(p2) # Addition
            j -= 1
            
    while i > 0: 
        align_exp.append(exp_data[i-1])
        align_heard.append(None)
        i -= 1
        
    return align_exp[::-1], align_heard[::-1], alignment_confidence

# ─── 5. LENIENCY HELPER FUNCTIONS ─────────────────────────────────────

def should_ignore_omission(phone: str, is_final: bool) -> bool:
    if phone == 'ə': return True
    if phone in HARD_TO_HEAR: return True 
    if is_final and phone in WEAK_ENDINGS: return True
    return False

def should_ignore_addition(phone: str, test_type: str = "comprehensive") -> bool:
    p_class = get_phone_class(phone) 
    if test_type == "epenthesis":
        if p_class == 'VOWEL': return False
        return phone in IGNORED_ADDITION_CONSONANTS
    if p_class == 'VOWEL' and phone != 'ə': return True
    if phone in IGNORED_ADDITION_CONSONANTS or phone in ('ː', 'ə'): return True
    return False