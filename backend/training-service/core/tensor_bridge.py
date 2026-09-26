import numpy as np
from core.constants import PHONEMES as PHONEME_LIST, P2I, ERROR_MAP


class TensorBridge:
    def __init__(self):
        self.ipa_cleaning_map = {"g": "g", "ɡ": "g", "r": "r", "ɾ": "r"}

    def initialize_tensor(self):
        """Returns a 3D tensor initialized to -1.0 (Untested)."""
        return np.full((3, 64, 9), -1.0, dtype=np.float32).tolist()

    def _unify_phoneme(self, symbol):
        if not symbol: return None
        if symbol in P2I: return symbol
        if symbol in self.ipa_cleaning_map:
            mapped = self.ipa_cleaning_map[symbol]
            if mapped in P2I: return mapped
        if len(symbol) > 1 and symbol[0] in P2I: return symbol[0]
        return None

    def _determine_position(self, item):
        pos_str = str(item.get('position', '')).lower()
        if any(x in pos_str for x in ['init', 'start']): return 0
        if any(x in pos_str for x in ['med', 'mid']): return 1
        if any(x in pos_str for x in ['fin', 'end']): return 2
        return 0

    def parse_backend_output(self, new_results):
        events = []
        for item in new_results:
            # 1. Determine Success/Failure
            result_status = (item.get('result') or "").lower()
            proc_name = (item.get('error_type') or item.get('process') or "").lower()
            
            is_correct = False
            err_idx = -1

            if result_status == "correct" or proc_name in ["correct", "none", "no error"]:
                is_correct = True
            else:
                # Identify specific error column
                for key, val in ERROR_MAP.items():
                    if key in proc_name:
                        err_idx = val
                        break
                if err_idx == -1: continue # Skip unknown error types if not correct

            # 2. Identify Target
            target_char = item.get('phoneme') or item.get('expected') or item.get('phone')
            clean_char = self._unify_phoneme(target_char)
            if not clean_char: continue
            
            events.append({
                'phoneme_idx': P2I[clean_char],
                'error_idx': err_idx,
                'pos_idx': self._determine_position(item),
                'is_correct': is_correct
            })
        return events

    def update_tensor(self, current_tensor_blob, new_results, learning_rate=0.2):
        """
        Updates tensor using Exponential Moving Average (EMA).
        -1.0 (Untested) -> Immediate overwrite.
        Existing Value -> Smooth update toward 0.0 (Correct) or 1.0 (Error).
        """
        if not (0.0 <= learning_rate <= 1.0):
            raise ValueError("learning_rate must be between 0.0 and 1.0.")

        # 1. Initialize or Load
        if current_tensor_blob is None:
            tensor = np.full((3, 64, 9), -1.0, dtype=np.float32)
        else:
            tensor = np.array(current_tensor_blob, dtype=np.float32)
            # Integrity check
            if tensor.shape != (3, 64, 9):
                raise ValueError("current_tensor must have shape (3, 64, 9).")

        events = self.parse_backend_output(new_results)
        
        for ev in events:
            c, h = ev['pos_idx'], ev['phoneme_idx']
            
            if ev['is_correct']:
                # SUCCESS LOGIC:
                # Drive all already-tested error slots for this phoneme/pos toward 0.0 via EMA.
                # Untested slots (-1.0) are left untouched — we have no evidence about them.
                valid_mask = tensor[c, h, :] >= 0.0
                tensor[c, h, :][valid_mask] = tensor[c, h, :][valid_mask] * (1.0 - learning_rate)
                
            else:
                # FAILURE LOGIC:
                w = ev['error_idx']
                current_val = tensor[c, h, w]
                
                if current_val == -1.0:
                    # First observation is an error -> Set high confidence immediately
                    tensor[c, h, w] = 1.0
                else:
                    # Recurring error -> EMA toward 1.0
                    # New = Old * (1-alpha) + 1.0 * alpha
                    tensor[c, h, w] = (current_val * (1.0 - learning_rate)) + (1.0 * learning_rate)

            # Keep tested cells in the valid probability range [0.0, 1.0].
            tested_mask = tensor >= 0.0
            tensor[tested_mask] = np.clip(tensor[tested_mask], 0.0, 1.0)

        return tensor.tolist()