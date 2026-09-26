import torch
import torch.nn as nn
import os

from config import (
    AEG_NUM_PHONEMES, AEG_NUM_ERRORS, AEG_NUM_MAJOR,
    AEG_NUM_POSITIONS, AEG_NUM_STRUCTURES, AEG_MAX_SEQ_LEN, AEG_HIDDEN_SIZE,
)

# ==========================================
# 1. MODEL ARCHITECTURE (AEG V5.4 / aeg_v5.pth)
# ==========================================
AEG_CONFIG = {
    "num_phonemes":   AEG_NUM_PHONEMES,
    "num_errors":     AEG_NUM_ERRORS,
    "num_major_types": AEG_NUM_MAJOR,
    "num_positions":  AEG_NUM_POSITIONS,
    "num_structures": AEG_NUM_STRUCTURES,
    "max_seq_len":    AEG_MAX_SEQ_LEN,
    "hidden_size":    AEG_HIDDEN_SIZE,
}

class AEGPolicyNetwork_V5_4(nn.Module):
    def __init__(self):
        super(AEGPolicyNetwork_V5_4, self).__init__()
        
        # Embeddings for categorical inputs
        self.emb_error = nn.Embedding(AEG_CONFIG['num_errors'], 8)
        self.emb_major = nn.Embedding(AEG_CONFIG['num_major_types'], 4)
        self.emb_pos = nn.Embedding(AEG_CONFIG['num_positions'], 4)
        
        # Input Dimension Calculation:
        # Cluster(64) + Trap(64) + Feat(8) + Emb_Err(8) + Emb_Maj(4) + Emb_Pos(4) + Flags(6) + Stats(4) = 162
        input_dim = 64 + 64 + 8 + 8 + 4 + 4 + 6 + 4 
        
        # Shared Encoder (Patient Embedding)
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 256),
            nn.BatchNorm1d(256), nn.ReLU(), nn.Dropout(0.2),
            nn.Linear(256, AEG_CONFIG['hidden_size']), nn.ReLU()
        )
        
        # Head A: Volume (Scalar)
        self.head_volume = nn.Linear(AEG_CONFIG['hidden_size'], 1)
        
        # Head B: Difficulty Progression (LSTM Sequence)
        self.lstm_diff = nn.LSTM(input_size=AEG_CONFIG['hidden_size'], hidden_size=64, batch_first=True)
        self.fc_diff = nn.Linear(64, 5) # 5 Difficulty levels
        self.emb_diff_cond = nn.Embedding(5, 8) # Embedding for the predicted difficulty to feed into other heads
        
        # Head D: Format Selector
        self.head_format = nn.Sequential(
            nn.Linear(AEG_CONFIG['hidden_size'] + 8 + 8 + 4, 64),
            nn.ReLU(),
            nn.Linear(64, 8) # 8 Activity Formats
        )

        # Head E: Targets (Residual Anchor)
        self.head_targets = nn.Sequential(
            nn.Linear(64 + 8 + 64, 128),
            nn.ReLU(),
            nn.Linear(128, 64)
        )
        
        # Head F: Structure Scaffolding
        self.head_struct = nn.Sequential(
            nn.Linear(64 + 8 + 8, 64),
            nn.ReLU(),
            nn.Linear(64, AEG_CONFIG['num_structures'])
        )
        
        # Head C: Safety/Forbidden (Residual Bypass)
        self.head_forbidden = nn.Linear(AEG_CONFIG['hidden_size'], 64)
        
        # Head C2: Dynamic Parameters
        self.head_dynamic = nn.Linear(AEG_CONFIG['hidden_size'], 5)

    def forward(self, error_idx, major_idx, pos_idx, cluster, trap, feat, flags, stats):
        # 1. Embed Categoricals
        e_err = self.emb_error(error_idx)
        e_maj = self.emb_major(major_idx)
        e_pos = self.emb_pos(pos_idx)
        
        # 2. Shared Encoding
        x_cat = torch.cat([cluster, trap, feat, e_err, e_maj, e_pos, flags, stats], dim=1)
        h_shared = self.encoder(x_cat)
        
        # 3. Head A: Volume
        pred_vol = self.head_volume(h_shared)
        
        # 4. Head B: Difficulty (LSTM)
        # Repeat shared vector for sequence length
        lstm_input = h_shared.unsqueeze(1).repeat(1, AEG_CONFIG['max_seq_len'], 1)
        lstm_out, _ = self.lstm_diff(lstm_input)
        pred_diff_logits = self.fc_diff(lstm_out)
        
        # Get predicted difficulty indices to condition other heads
        cond_diff = torch.argmax(pred_diff_logits, dim=2)
        cond_vec = self.emb_diff_cond(cond_diff)
        
        # Prepare repeated embeddings for sequence generation
        h_rep = h_shared.unsqueeze(1).repeat(1, AEG_CONFIG['max_seq_len'], 1)
        e_err_rep = e_err.unsqueeze(1).repeat(1, AEG_CONFIG['max_seq_len'], 1)
        e_maj_rep = e_maj.unsqueeze(1).repeat(1, AEG_CONFIG['max_seq_len'], 1)
        cluster_rep = cluster.unsqueeze(1).repeat(1, AEG_CONFIG['max_seq_len'], 1)
        
        # 5. Head D: Format
        fmt_input = torch.cat([h_rep, cond_vec, e_err_rep, e_maj_rep], dim=2)
        pred_fmt = self.head_format(fmt_input)
        
        # 6. Head E: Targets (With Residual Anchor)
        # Output = Net(x) + (Input_Cluster * 5.0)
        target_input = torch.cat([lstm_out, cond_vec, cluster_rep], dim=2)
        pred_targ = self.head_targets(target_input) + (cluster_rep * 5.0)
        
        # 7. Head F: Structure
        struct_input = torch.cat([lstm_out, cond_vec, e_err_rep], dim=2)
        pred_struct = self.head_struct(struct_input)
        
        # 8. Head C: Forbidden (With Residual Bypass)
        # Output = Net(x) + (Input_Trap * 10.0)
        pred_forbid = self.head_forbidden(h_shared) + (trap * 10.0)
        
        # 9. Head C2: Dynamic
        pred_dyn = self.head_dynamic(h_shared)
        
        return pred_vol, pred_diff_logits, pred_fmt, pred_targ, pred_struct, pred_forbid, pred_dyn

# ==========================================
# 2. LOADER UTILITY
# ==========================================
def load_aeg_model(model_path, device):
    """
    Initializes the model and loads weights safely.
    """
    print(f"--- Loading AEG V5.4 from {model_path} ---")
    model = AEGPolicyNetwork_V5_4().to(device)
    
    if os.path.exists(model_path):
        try:
            state_dict = torch.load(model_path, map_location=device, weights_only=True)
            model.load_state_dict(state_dict)
            model.eval() # Set to inference mode
            print("✅ AEG Weights Loaded Successfully")
        except Exception as e:
            print(f"❌ CRITICAL: Failed to load AEG weights: {e}")
            raise e
    else:
        print(f"⚠️ WARNING: Model file not found at {model_path}. Running with random weights (Debugging Mode).")
    
    return model
