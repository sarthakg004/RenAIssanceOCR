"""Project paths. Importing this module puts backend/ on sys.path."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
EXPERIMENTS = ROOT / "experimentation"
DATA = EXPERIMENTS / "data"
CHECKPOINTS = EXPERIMENTS / "checkpoints"
ASSETS = ROOT / "assets"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
