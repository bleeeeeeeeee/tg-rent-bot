import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
IMPORTS_DIR = BASE_DIR / "imports"
IMPORTS_DIR.mkdir(parents=True, exist_ok=True)

TELEGRAM_API_ID = os.getenv("TELEGRAM_API_ID")
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_ADMIN_ID = int(os.getenv("TELEGRAM_ADMIN_ID"))
GOOGLE_SHEET_KEY = os.getenv("GOOGLE_SHEET_KEY")

ADMIN_ID = TELEGRAM_ADMIN_ID
