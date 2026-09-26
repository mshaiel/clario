import torch
import torch.nn as nn
import numpy as np
import os

from config import AMLM_LATENT_DIM as LATENT_DIM
from core.constants import PHONEMES as _PHONEME_LIST

# ==========================================
# 1. MODEL ARCHITECTURE (AMLM V7 / amlm_v5.pth)
# ==========================================
class AMLM_3D(nn.Module):
    def __init__(self):
        super(AMLM_3D, self).__init__()
        
        # --- ENCODER ---
        # Input: (Batch, 6, 64, 9) 
        # 6 Channels = 3 Value Channels (Data) + 3 Visibility Channels (Mask)
        self.encoder = nn.Sequential(
            # Layer 1: 64x9 -> 32x9
            nn.Conv2d(6, 32, kernel_size=3, padding=1), 
            nn.ReLU(), 
            nn.MaxPool2d((2, 1)), 
            
            # Layer 2: 32x9 -> 16x9
            nn.Conv2d(32, 64, kernel_size=3, padding=1), 
            nn.ReLU(), 
            nn.MaxPool2d((2, 1)), 
            
            # Flatten: 64 channels * 16 height * 9 width = 9216
            nn.Flatten() 
        )
        
        # --- BOTTLENECK ---
        # Compresses the 9216 features into the 64-dim "Clinical Syndrome" vector
        self.bottleneck = nn.Sequential(
            nn.Linear(9216, 256), 
            nn.ReLU(), 
            nn.Linear(256, LATENT_DIM) 
        )
        
        # --- DECODER INPUT ---
        # Expands 64-dim syndrome back to spatial features
        self.decoder_input = nn.Sequential(
            nn.Linear(LATENT_DIM, 256), 
            nn.ReLU(), 
            nn.Linear(256, 9216), 
            nn.ReLU()
        )
        
        # --- DECODER ---
        # Reconstructs the full probability map
        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(64, 32, kernel_size=3, padding=1), 
            nn.Upsample(scale_factor=(2, 1)), 
            nn.ReLU(),
            
            nn.ConvTranspose2d(32, 16, kernel_size=3, padding=1), 
            nn.Upsample(scale_factor=(2, 1)), 
            nn.ReLU(),
            
            # Output: 3 Channels (Initial, Medial, Final)
            nn.Conv2d(16, 3, kernel_size=3, padding=1), 
            nn.Sigmoid() # Squish output to 0.0 - 1.0 probability
        )

    def forward(self, x):
        """
        Forward pass for inference.
        x shape must be: (Batch_Size, 6, 64, 9)
        """
        features = self.encoder(x)
        latent = self.bottleneck(features) 
        
        x_recon = self.decoder_input(latent)
        # Reshape back to spatial dimensions (Batch, Channels, Height, Width)
        x_recon = x_recon.view(-1, 64, 16, 9) 
        
        # Output map (Batch, 3, 64, 9)
        output = self.decoder(x_recon)
        
        return output, latent

# ==========================================
# 2. VALIDITY MASK  (mirrors data_generation_script.py :: build_validity_mask_3d)
# ==========================================
def _pidx(symbols):
    s = set(symbols)
    return [i for i, p in enumerate(_PHONEME_LIST) if p in s]

def build_validity_mask() -> np.ndarray:
    """
    Builds the (3, 64, 9) float32 validity mask that matches the AMLM training
    data generator exactly (data_generation_script.py :: build_validity_mask_3d).
    Must be applied to every AMLM output to suppress physically impossible predictions.
    """
    VELARS      = _pidx(['k', 'g', 'kʰ', 'ɡʰ', 'q', 'x', 'ɣ', 'ŋ'])
    FRICATIVES  = _pidx(['f', 'v', 's', 'z', 'ʃ', 'ʒ', 'ʂ', 'ʐ', 'x', 'ɣ', 'h', 'θ', 'ð'])
    AFFRICATES  = _pidx(['tʃ', 'dʒ'])
    LIQUIDS     = _pidx(['l', 'lʰ', 'r', 'rʰ', 'ɽ', 'ɽʰ'])
    NASALS      = _pidx(['m', 'mʰ', 'n', 'nʰ', 'ŋ', 'ɳ'])
    VOWELS      = _pidx(['a', 'aː', 'i', 'iː', 'u', 'uː', 'e', 'eː', 'o', 'oː', 'ə', 'æ', 'ɔ', 'ɪ', 'ʊ'])
    CONSONANTS  = [i for i in range(64) if i not in set(VOWELS)]
    CONTINUANTS = list(set(FRICATIVES + LIQUIDS + NASALS + VOWELS))

    # Column indices: [Sub, Front, Stop, Glide, Clust, Epen, Block, Prolong, Repeat]
    IDX_SUB=0; IDX_FRONT=1; IDX_STOP=2; IDX_GLIDE=3
    IDX_CLUST=4; IDX_EPEN=5; IDX_BLOCK=6; IDX_PROLONG=7; IDX_REPEAT=8

    mask = np.zeros((3, 64, 9), dtype=np.float32)
    for p in VELARS:              mask[:, p, IDX_FRONT]   = 1.0
    for p in FRICATIVES+AFFRICATES: mask[:, p, IDX_STOP]  = 1.0
    for p in LIQUIDS:             mask[:, p, IDX_GLIDE]   = 1.0
    for p in CONSONANTS:
        mask[:, p, IDX_CLUST] = 1.0
        mask[:, p, IDX_EPEN]  = 1.0
        mask[:, p, IDX_SUB]   = 1.0
    mask[:, :, IDX_BLOCK]  = 1.0
    for p in CONTINUANTS:         mask[:, p, IDX_PROLONG] = 1.0
    mask[:, :, IDX_REPEAT] = 1.0
    return mask


# ==========================================
# 3. LOADER UTILITY
# ==========================================
def load_amlm_model(model_path, device):
    """
    Initializes the model and loads weights safely.
    """
    print(f"--- Loading AMLM V7 from {model_path} ---")
    model = AMLM_3D().to(device)
    
    if os.path.exists(model_path):
        try:
            state_dict = torch.load(model_path, map_location=device, weights_only=True)
            model.load_state_dict(state_dict)
            model.eval() # Set to inference mode (freezes Dropout/BatchNorm)
            print("✅ AMLM Weights Loaded Successfully")
        except Exception as e:
            print(f"❌ CRITICAL: Failed to load AMLM weights: {e}")
            # We assume the app should crash or handle this if weights are bad
            raise e
    else:
        print(f"⚠️ WARNING: Model file not found at {model_path}. Running with random weights (Debugging Mode).")
    
    return model
