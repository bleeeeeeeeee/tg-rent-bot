"""
Admin Bot – Telegram Control Panel for the Telegram Farm Management System.

Runs a persistent aiogram 3.x bot that ONLY responds to a single admin
Telegram user (identified by ADMIN_ID).  All other users are silently
ignored via the AdminFilter middleware.

Key features:
  1. Strict ADMIN_ID access control on EVERY command and callback.
  2. Interactive InlineKeyboard UI (Dashboard, Launch Farm, Import).
  3. Async orchestrator execution without blocking the polling loop.
  4. Log-relay handler that pipes orchestrator logs back to the admin chat.

Usage:
    cd "d:\Prog Project\tg_farm_manager"
    python ..\admin_bot.py
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# ── Ensure project packages are importable regardless of cwd ──
_project_root = Path(__file__).resolve().parent / "tg_farm_manager"
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from aiogram import Bot, Dispatcher, Router, F
from aiogram.filters import Command
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

import config.settings as settings
from config.settings import (
    BOT_TOKEN,
    ADMIN_ID,
    BOT_USERNAME,
    STATUS_ACTIVE,
    STATUS_BANNED,
    STATUS_SPAMBLOCK,
    STATUS_ON_HOLD,
    LOG_DIR,
    LOG_LEVEL,
)
from utils.logger import setup_logging
from database.db_manager import DatabaseManager

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────
LOG_RELAY_QUEUE_SIZE = 256
ORCH_MAX_MSGS = 150

TEXTS = {
    "ru": {
        "stats": "📊 Статистика",
        "launch": "🚀 Запустить",
        "import": "📥 Импорт аккаунта",
        "help": "ℹ️ Помощь",
        "lang": "🌐 Язык: Русский",
        "initializing": "🤖 Бот запускается… попробуйте ещё раз чуть позже.",
        "welcome": (
            "🔐 <b>Панель администратора</b>\n\n"
            "Вы вошли как администратор.\n"
            "Используйте кнопки ниже или команды:\n"
            "  /stats — статистика аккаунтов\n"
            "  /launch — запустить обработку\n"
            "  /import — импорт аккаунтов\n"
            "  /help — справка\n\n"
            "🔒 Бот доступен только администратору."
        ),
        "lang_changed": "Язык интерфейса изменён на русский.",
    },
    "en": {
        "stats": "📊 Statistics",
        "launch": "🚀 Launch",
        "import": "📥 Import account",
        "help": "ℹ️ Help",
        "lang": "🌐 Language: English",
        "initializing": "🤖 The bot is starting… please try again shortly.",
        "welcome": (
            "🔐 <b>Admin Panel</b>\n\n"
            "You are authenticated as the administrator.\n"
            "Use the buttons below or these commands:\n"
            "  /stats — account statistics\n"
            "  /launch — start processing\n"
            "  /import — import accounts\n"
            "  /help — show help\n\n"
            "🔒 This bot is accessible only to the administrator."
        ),
        "lang_changed": "The interface language is now English.",
    },
}

logger = logging.getLogger("admin_bot")


# ═════════════════════════════════════════════
# 1.  Security Filter – ADMIN_ID gate
# ═════════════════════════════════════════════
class AdminFilter:
    """Only the configured ADMIN_ID may interact with this bot."""

    key = "admin"
    params_key = "admin"

    async def __call__(self, message: Message) -> bool:
        user_id = message.from_user.id
        if user_id != ADMIN_ID:
            logger.warning(
                "⛔ Unauthorized access attempt from user_id=%s", user_id,
            )
            return False
        return True

    async def __call__(self, callback: CallbackQuery) -> bool:
        user_id = callback.from_user.id
        if user_id != ADMIN_ID:
            logger.warning(
                "⛔ Unauthorized callback attempt from user_id=%s", user_id,
            )
            return False
        return True


# ═════════════════════════════════════════════
# 2.  Telegram Log Relay
# ═════════════════════════════════════════════
class TelegramLogRelay:
    """
    Buffers log messages in an asyncio.Queue; a background consumer
    reads the queue and forwards messages to the admin Telegram chat.
    The handler never blocks so the orchestrator log stream stays free.
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue(maxsize=LOG_RELAY_QUEUE_SIZE)
        self._bot: Bot | None = None
        self._admin_chat_id: int | None = None
        self._task: asyncio.Task | None = None
        self._active = False
        self._messages_sent: int = 0
        self._messages_limit: int = ORCH_MAX_MSGS
        self._coalesce_buf: str = ""
        self._coalesce_cnt: int = 0

    async def start(self, bot: Bot, chat_id: int) -> None:
        self._bot = bot
        self._admin_chat_id = chat_id
        self._active = True
        self._task = asyncio.create_task(self._consumer(), name="log-relay")
        logger.info("TelegramLogRelay started → chat_id=%s", chat_id)

    async def stop(self) -> None:
        self._active = False
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("TelegramLogRelay stopped.")

    async def reset(self) -> None:
        self._messages_sent = 0
        self._coalesce_buf = ""
        self._coalesce_cnt = 0

    async def emit(self, text: str) -> None:
        if not self._active:
            return
        if self._messages_sent >= self._messages_limit:
            await self._queue.put(f"⚠️  Log relay limit reached ({self._messages_limit} msgs).")
            self._active = False
            return
        try:
            self._queue.put_nowait(text)
        except asyncio.QueueFull:
            logger.debug("Log relay queue full – message dropped.")

    async def _consumer(self) -> None:
        while self._active:
            try:
                msg = await asyncio.wait_for(self._queue.get(), timeout=0.5)
                await self._send_safe(msg)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in log relay consumer.")

    async def _send_safe(self, text: str) -> None:
        if self._bot is None or self._admin_chat_id is None:
            return
        if len(text) < 40:
            self._coalesce_cnt += 1
            self._coalesce_buf += text + "\n"
            if self._coalesce_cnt >= 4:
                await self._do_send(self._coalesce_buf.strip())
                self._coalesce_buf = ""
                self._coalesce_cnt = 0
            return
        await self._do_send(text)

    async def _do_send(self, text: str) -> None:
        try:
            truncated = text[:1900]
            await self._bot.send_message(
                chat_id=self._admin_chat_id,
                text=f"`{truncated}`",
                parse_mode="Markdown",
                disable_web_page_preview=True,
            )
            self._messages_sent += 1
        except Exception:
            logger.debug("Failed to relay log message to Telegram.")

    def handle(self, record: logging.LogRecord) -> None:
        fmt = logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%H:%M:%S",
        )
        text = fmt.format(record)
        try:
            loop = asyncio.get_running_loop()
            asyncio.ensure_future(self.emit(text), loop=loop)
        except RuntimeError:
            logger.debug("No running loop for log relay.")


# ═════════════════════════════════════════════
# 3.  Keyboard Builder
# ═════════════════════════════════════════════
def _build_main_keyboard() -> InlineKeyboardMarkup:
    lang = settings.CURRENT_BOT_LANG
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=TEXTS[lang]["stats"], callback_data="stats"),
                InlineKeyboardButton(text=TEXTS[lang]["launch"], callback_data="launch"),
            ],
            [
                InlineKeyboardButton(text=TEXTS[lang]["import"], callback_data="import"),
                InlineKeyboardButton(text=TEXTS[lang]["help"], callback_data="help"),
            ],
            [
                InlineKeyboardButton(text=TEXTS[lang]["lang"], callback_data="toggle_language"),
            ],
        ],
    )


# ═════════════════════════════════════════════
# 4.  Bot-wide state
# ═════════════════════════════════════════════
_log_relay = TelegramLogRelay()
_orchestrator_task: asyncio.Task | None = None
_orchestrator_running: bool = False
_db: DatabaseManager | None = None
_bot: Bot | None = None
_admin_chat_id: int | None = None


# ═════════════════════════════════════════════
# 5.  Router & Handlers
# ═════════════════════════════════════════════
admin_filter = AdminFilter()
router = Router()
router.message.filter(admin_filter)
router.callback_query.filter(admin_filter)


# ── helper: reply to Message or CallbackQuery ─
async def _reply(obj: Message | CallbackQuery, text: str, parse_mode: str = "HTML") -> None:
    kb = _build_main_keyboard()
    if isinstance(obj, CallbackQuery):
        await obj.message.answer(text, parse_mode=parse_mode, reply_markup=kb)
    else:
        await obj.answer(text, parse_mode=parse_mode, reply_markup=kb)


# ── /start ───────────────────────────────────
@router.message(Command("start"))
async def cmd_start(message: Message) -> None:
    global _admin_chat_id
    _admin_chat_id = message.chat.id

    if not _bot:
        await message.answer(
            TEXTS[settings.CURRENT_BOT_LANG]["initializing"],
            reply_markup=_build_main_keyboard(),
        )
        return

    await _log_relay.start(_bot, _admin_chat_id)

    await message.answer(
        TEXTS[settings.CURRENT_BOT_LANG]["welcome"],
        parse_mode="HTML",
        reply_markup=_build_main_keyboard(),
    )


@router.callback_query(F.data == "toggle_language")
async def toggle_language(callback: CallbackQuery) -> None:
    settings.CURRENT_BOT_LANG = "en" if settings.CURRENT_BOT_LANG == "ru" else "ru"
    lang = settings.CURRENT_BOT_LANG

    await callback.answer(TEXTS[lang]["lang_changed"])
    await _reply(callback, TEXTS[lang]["welcome"])
    if callback.message:
        await callback.message.delete()


# ── /help ────────────────────────────────────
@router.message(Command("help"))
@router.callback_query(F.data == "help")
async def cmd_help(obj: Message | CallbackQuery) -> None:
    text = (
        "📖 <b>Admin Bot Commands</b>\n\n"
        "  /start   – authenticate & show menu\n"
        "  /stats   – dashboard statistics\n"
        "  /launch  – trigger farm processing\n"
        "  /import  – import new account files\n"
        "  /help    – show this help\n\n"
        "You can also send <code>.session</code>, <code>.csv</code>, "
        "<code>.txt</code>, or <code>.json</code> files directly "
        "to this chat.\n\n"
        "⚠️  Long-running farm runs may take several minutes."
    )
    await _reply(obj, text)


# ── /launch / Launch callback ────────────────
@router.message(Command("launch"))
@router.callback_query(F.data == "launch")
async def cmd_launch(obj: Message | CallbackQuery) -> None:
    global _orchestrator_task, _orchestrator_running, _db

    if _orchestrator_running:
        await _reply(obj, "⚠️  Farm orchestrator is already running. Please wait.")
        return

    if _db is None:
        _db = DatabaseManager()
        await _db.connect()

    if not BOT_USERNAME:
        await _reply(obj, (
            "⚠️  <b>BOT_USERNAME not configured!</b>\n\n"
            "Set <code>BOT_USERNAME</code> in <code>config/settings.py</code>."
        ))
        return

    _orchestrator_running = True
    await _log_relay.reset()
    await _log_relay.emit("🚀 Farm run initiated …")

    _orchestrator_task = asyncio.create_task(
        _run_farm_in_background(BOT_USERNAME),
        name="farm-orchestrator",
    )

    await _reply(obj, (
        "🚀 <b>Farm run started!</b>\n"
        "Progress updates will appear below."
    ))


# ── /stats / Dashboard callback ──────────────
@router.message(Command("stats"))
@router.callback_query(F.data == "stats")
async def cmd_stats(obj: Message | CallbackQuery) -> None:
    global _db
    if _db is None:
        _db = DatabaseManager()
        await _db.connect()

    try:
        stats = await _db.get_stats()
    except Exception as exc:
        logger.error("Failed to get stats: %s", exc)
        await _reply(obj, "❌ Failed to query database.")
        return

    text = (
        f"📊 <b>Farm Dashboard</b>\n\n"
        f"📦 Total accounts : <b>{stats['total']}</b>\n"
        f"✅ Active         : <b>{stats['active']}</b>\n"
        f"🚫 Banned         : <b>{stats['banned']}</b>\n"
        f"⛔ Spamblock      : <b>{stats['spamblock']}</b>\n"
        f"⏸️  On Hold       : <b>{stats['on_hold']}</b>\n"
        f"🌐 With proxy     : <b>{stats['with_proxy']}</b>\n"
        f"💰 Wallets bound  : <b>{stats['wallets_bound']}</b>"
    )
    await _reply(obj, text)


# ── /import ──────────────────────────────────
@router.message(Command("import"))
@router.callback_query(F.data == "import")
async def cmd_import(obj: Message | CallbackQuery) -> None:
    await _reply(
        obj,
        (
            "📥 <b>Import Accounts</b>\n\n"
            "Send me a file with one of these formats:\n\n"
            "  • <code>.session</code> – Telethon session file\n"
            "  • <code>.csv</code>      – CSV with phone numbers\n"
            "  • <code>.txt</code>      – text file with phone numbers\n"
            "  • <code>.json</code>     – JSON array of accounts\n\n"
            "Files will be imported into the farm database."
        ),
    )


# ── File upload handler ──────────────────────
@router.message()
async def handle_file_upload(message: Message) -> None:
    """Accept .session, .csv, .txt, .json files from admin."""
    if not message.document:
        return  # non-file messages handled by commands above

    import shutil
    import tempfile

    doc = message.document
    ext = Path(doc.file_name).suffix.lower() if doc.file_name else ""

    ALLOWED_EXTS = {".session", ".csv", ".txt", ".json"}
    if ext not in ALLOWED_EXTS:
        await message.answer(
            "❌ Unsupported file type. Send .session, .csv, .txt, or .json.",
            reply_markup=_build_main_keyboard(),
        )
        return

    temp_dir = Path(LOG_DIR).parent / "temp_imports"
    temp_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False, dir=temp_dir) as tmp:
        tmp_path = Path(tmp.name)

    try:
        await message.download(temp_path=str(tmp_path))

        if _db is None:
            _db = DatabaseManager()
            await _db.connect()

        if ext in (".csv", ".txt"):
            phones = _read_phones_from_file(tmp_path)
            imported = await _db.import_phone_numbers(phones)
            msg = f"✅ Imported {imported} account(s) from {doc.file_name}."
        elif ext == ".json":
            imported = await _db.import_json_file(str(tmp_path))
            msg = f"✅ Imported {imported} account(s) from {doc.file_name}."
        else:
            # .session – copy to sessions dir
            sessions_dir = Path(LOG_DIR).parent / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)
            dest = sessions_dir / doc.file_name
            shutil.copy2(str(tmp_path), str(dest))
            msg = f"✅ Session file saved to sessions directory."

        await message.answer(msg, reply_markup=_build_main_keyboard())

    except Exception as exc:
        logger.exception("File import failed: %s", exc)
        await message.answer(
            f"❌ Import failed: {exc}",
            reply_markup=_build_main_keyboard(),
        )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def _read_phones_from_file(path: Path) -> list[str]:
    """Read phone numbers from .csv or .txt (one per line or csv column)."""
    import csv

    phones: list[str] = []
    with open(path, encoding="utf-8", errors="replace") as f:
        if path.suffix.lower() == ".csv":
            reader = csv.reader(f)
            for row in reader:
                for cell in row:
                    p = cell.strip()
                    if p and p.startswith("+"):
                        phones.append(p)
        else:
            for line in f:
                p = line.strip()
                if p and p.startswith("+"):
                    phones.append(p)
    return phones


# ═════════════════════════════════════════════
# 6.  Background Farm Runner
# ═════════════════════════════════════════════
async def _run_farm_in_background(bot_username: str) -> None:
    """Execute the full farm pipeline in a background asyncio task."""
    global _orchestrator_running
    logger.info("Background farm run started.")
    try:
        from orchestrator import run_orchestrator

        await run_orchestrator(bot_username)

        await _log_relay.emit("✅ Farm run completed successfully.")
    except Exception as exc:
        logger.exception("Farm run failed: %s", exc)
        await _log_relay.emit(f"❌ Farm run failed: {exc}")
    finally:
        _orchestrator_running = False
        await _log_relay.stop()
        logger.info("Background farm run finished.")


# ═════════════════════════════════════════════
# 7.  Entry Point
# ═════════════════════════════════════════════
async def main() -> None:
    """Initialise bot, dispatcher, logging, and start polling."""
    global _bot

    # ── Setup logging ──
    setup_logging(level=LOG_LEVEL)
    logger.info("Admin Bot initialising …")

    # ── Create bot & dispatcher ──
    _bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()
    dp.include_router(router)

    logger.info("Starting polling …")
    try:
        await dp.start_polling(_bot)
    except KeyboardInterrupt:
        logger.info("Bot stopped by keyboard interrupt.")
    except Exception as exc:
        logger.critical("Bot crashed: %s", exc)
    finally:
        if _bot:
            await _bot.session.close()
            logger.info("Bot session closed.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Bye!")
    except Exception as e:
        print(f"💥 Fatal: {e}")
        sys.exit(1)
