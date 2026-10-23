"""
Admin Bot – Telegram Control Panel for the Telegram Farm Management System.

Runs a persistent aiogram 3.x bot that ONLY responds to a single admin
Telegram user (identified by ADMIN_ID).  All other users are silently
ignored via the AdminFilter.

Key features:
  1. Strict ADMIN_ID access control on EVERY command and callback.
  2. A single editable InlineKeyboard control panel with FSM input.
  3. Async orchestrator execution without blocking the polling loop.
  4. Process logs are rendered in the control panel instead of new messages.

Usage:
    cd "d:\Prog Project\tg_farm_manager"
    python ..\admin_bot.py
"""

from __future__ import annotations

import asyncio
import html
import logging
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path

# ── Ensure project packages are importable regardless of cwd ──
_project_root = Path(__file__).resolve().parent / "tg_farm_manager"
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from aiogram import BaseMiddleware, Bot, Dispatcher, Router, F
from aiogram.filters import BaseFilter, Command, CommandStart
from aiogram.exceptions import TelegramAPIError, TelegramBadRequest
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
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
    LOG_DIR,
    LOG_LEVEL,
)
from utils.logger import setup_logging
from database.db_manager import DatabaseManager, Account
from tg_farm_manager.orchestrator import FarmOrchestrator
from utils.localization import LocalizationManager

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────
LOG_RELAY_QUEUE_SIZE = 256
ORCH_MAX_MSGS = 150
localization = LocalizationManager()

logger = logging.getLogger("admin_bot")


@dataclass
class BotSettings:
    lang: str = "ru"
    show_hints: bool = True
    process_active: bool = False


bot_settings = BotSettings()
db = DatabaseManager()
orchestrator = FarmOrchestrator(BOT_USERNAME)
_orchestrator_task: asyncio.Task | None = None
settings.CURRENT_BOT_LANG = bot_settings.lang

_PANEL_TEXTS = {
    "ru": {
        "main_title": "⚙️ Панель администратора",
        "status_label": "Состояние",
        "status_running": "процесс запущен",
        "status_stopped": "процесс остановлен",
        "main_hint": (
            "💡 <i>Инструкция: Используйте меню настроек для изменения "
            "параметров отображения пульта.</i>"
        ),
        "settings_view": (
            "<b>⚙️ Настройки интерфейса</b>\n\n"
            "Здесь можно переключить язык и отображение подсказок."
        ),
        "input_screen": (
            "<b>📥 Ввод текстовых данных</b>\n\n"
            "Пришлите номер телефона и прокси через разделитель:\n"
            "<code>+79990000000 | socks5://user:pass@host:port</code>"
        ),
        "input_saved": "<b>✅ Данные сохранены.</b>",
        "input_invalid": (
            "<b>❌ Не удалось сохранить данные.</b>\n\n"
            "Укажите номер телефона перед разделителем <code>|</code>."
        ),
        "input_save_failed": "<b>❌ Ошибка сохранения данных.</b>",
        "session_instruction": (
            "Перенесите готовый файл сессии в папку <code>sessions/</code> "
            "и переименуйте его строго в <code>{session_name}.session</code>."
        ),
        "stats_title": "📊 Статистика аккаунтов",
        "stats_unavailable": "Статистика пока недоступна.",
        "stats_total": "📦 Всего аккаунтов",
        "stats_active": "✅ Активны",
        "stats_banned": "🚫 Заблокированы",
        "stats_spamblock": "⛔ Ограничены",
        "stats_on_hold": "⏸️ На паузе",
        "stats_proxy": "🌐 С прокси",
        "stats_wallets": "💰 С привязанным кошельком",
        "language_button": "🌐 Язык: RU / EN",
        "hints_show_button": "📖 Подсказки: Показать",
        "hints_hide_button": "📖 Подсказки: Скрыть",
        "back_button": "↩️ Назад",
        "stats_button": "📊 Статистика",
        "start_button": "🚀 Старт процесса",
        "stop_button": "🛑 Стоп процесса",
        "input_button": "📥 Ввод параметров",
        "settings_button": "⚙️ Настройки",
        "cancel_button": "❌ Отмена",
        "logs_title": "<b>Последние события</b>",
    },
    "en": {
        "main_title": "⚙️ Admin panel",
        "status_label": "Status",
        "status_running": "process is running",
        "status_stopped": "process is stopped",
        "main_hint": (
            "💡 <i>Hint: Use the settings menu to change the panel display options.</i>"
        ),
        "settings_view": (
            "<b>⚙️ Interface settings</b>\n\n"
            "Change the language and hint visibility here."
        ),
        "input_screen": (
            "<b>📥 Text input</b>\n\n"
            "Send the phone number and proxy separated by a pipe:\n"
            "<code>+19990000000 | socks5://user:pass@host:port</code>"
        ),
        "input_saved": "<b>✅ Data saved.</b>",
        "input_invalid": (
            "<b>❌ The data could not be saved.</b>\n\n"
            "Enter a phone number before the <code>|</code> separator."
        ),
        "input_save_failed": "<b>❌ Failed to save the data.</b>",
        "session_instruction": (
            "Move the ready session file to the <code>sessions/</code> folder "
            "and name it exactly <code>{session_name}.session</code>."
        ),
        "stats_title": "📊 Account statistics",
        "stats_unavailable": "Statistics are not available yet.",
        "stats_total": "📦 Total accounts",
        "stats_active": "✅ Active",
        "stats_banned": "🚫 Banned",
        "stats_spamblock": "⛔ Restricted",
        "stats_on_hold": "⏸️ On hold",
        "stats_proxy": "🌐 With proxy",
        "stats_wallets": "💰 Wallets linked",
        "language_button": "🌐 Language: RU / EN",
        "hints_show_button": "📖 Hints: Show",
        "hints_hide_button": "📖 Hints: Hide",
        "back_button": "↩️ Back",
        "stats_button": "📊 Statistics",
        "start_button": "🚀 Start process",
        "stop_button": "🛑 Stop process",
        "input_button": "📥 Enter text",
        "settings_button": "⚙️ Settings",
        "cancel_button": "❌ Cancel",
        "logs_title": "<b>Recent activity</b>",
    },
}


def render_view(view_name: str, settings: BotSettings) -> str:
    """Return the HTML text for a supported panel view."""
    lang = settings.lang if settings.lang in _PANEL_TEXTS else "ru"
    text = _PANEL_TEXTS[lang]

    if view_name == "main":
        status_key = "status_running" if settings.process_active else "status_stopped"
        content = (
            f"<b>{text['main_title']}</b>\n\n"
            f"{text['status_label']}: <b>{text[status_key]}</b>."
        )
        if settings.show_hints:
            content += f"\n\n{text['main_hint']}"
        return content
    if view_name == "settings":
        return text["settings_view"]
    if view_name == "input_screen":
        return text["input_screen"]
    raise ValueError(f"Unsupported view: {view_name!r}")


_panel_notice: str | None = None
_stats_snapshot: dict[str, int] | None = None
_recent_logs: tuple[str, ...] = ()
_active_view = "main"


def _render_stats_view() -> str:
    lang = bot_settings.lang if bot_settings.lang in _PANEL_TEXTS else "ru"
    text = _PANEL_TEXTS[lang]
    lines = [f"<b>{text['stats_title']}</b>"]
    if _panel_notice:
        lines.append(_panel_notice)
    elif _stats_snapshot is None:
        lines.append(text["stats_unavailable"])
    else:
        rows = (
            ("total", "stats_total"),
            ("active", "stats_active"),
            ("banned", "stats_banned"),
            ("on_hold", "stats_on_hold"),
        )
        lines.extend(
            f"{text[label]}: <b>{html.escape(str(_stats_snapshot.get(key, 0)))}</b>"
            for key, label in rows
        )
    return "\n\n".join(lines)


def _render_panel_content(view_name: str) -> str:
    if view_name == "stats":
        return _render_stats_view()
    if view_name == "input_result":
        return _panel_notice or "<b>✅ Данные приняты!</b>"

    content = render_view(view_name, bot_settings)
    lang = bot_settings.lang if bot_settings.lang in _PANEL_TEXTS else "ru"
    text = _PANEL_TEXTS[lang]
    additions: list[str] = []

    if view_name == "main":
        hint = f"\n\n{text['main_hint']}"
        if bot_settings.show_hints:
            content = content[:-len(hint)]
        if _panel_notice:
            additions.append(_panel_notice)
        if _recent_logs:
            raw_logs = "\n".join(_recent_logs)[-550:]
            additions.append(
                f"{text['logs_title']}\n<pre>{html.escape(raw_logs)}</pre>"
            )
        if bot_settings.show_hints:
            additions.append(text["main_hint"])
    elif view_name == "input_screen" and _panel_notice:
        additions.append(_panel_notice)

    return "\n\n".join([content, *additions])


# ═════════════════════════════════════════════
# 1.  Localization Middleware
# ═════════════════════════════════════════════
class LocalizationMiddleware(BaseMiddleware):
    """Expose the current interface language to each handler as ``lang``."""

    async def __call__(self, handler, event, data):
        data["lang"] = bot_settings.lang
        return await handler(event, data)


# ═════════════════════════════════════════════
# 2.  Security Filter – ADMIN_ID gate
# ═════════════════════════════════════════════
class AdminFilter(BaseFilter):
    """Only the configured ADMIN_ID may interact with this bot."""

    key = "admin"
    params_key = "admin"

    async def __call__(self, event: Message | CallbackQuery) -> bool:
        user_id = event.from_user.id if event.from_user else None
        if user_id != ADMIN_ID:
            logger.warning(
                "⛔ Unauthorized access attempt from user_id=%s", user_id,
            )
            return False
        return True


class MenuStates(StatesGroup):
    waiting_for_text = State()


# ═════════════════════════════════════════════
# 2.  Telegram Log Relay
# ═════════════════════════════════════════════
class TelegramLogRelay(logging.Handler):
    """
    Buffers log messages in an asyncio.Queue; a background consumer
    reads the queue and renders them into the existing control panel.
    Logging calls only enqueue work, so they do not block the orchestrator.
    """

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%H:%M:%S",
        ))
        self._queue: asyncio.Queue[str] = asyncio.Queue(maxsize=LOG_RELAY_QUEUE_SIZE)
        self._bot: Bot | None = None
        self._admin_chat_id: int | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task | None = None
        self._active = False
        self._messages_sent: int = 0
        self._messages_limit: int = ORCH_MAX_MSGS
        self._coalesce_buf: str = ""
        self._coalesce_cnt: int = 0
        self._recent_lines: deque[str] = deque(maxlen=12)
        self._last_edit_at: float = 0.0

    async def start(self, bot: Bot, chat_id: int) -> None:
        if self._task and not self._task.done():
            return
        self._bot = bot
        self._admin_chat_id = chat_id
        self._loop = asyncio.get_running_loop()
        self._active = True
        self._recent_lines.clear()
        self._last_edit_at = 0.0
        self._task = asyncio.create_task(self._consumer(), name="log-relay")
        logging.getLogger().addHandler(self)
        logger.info("TelegramLogRelay started → chat_id=%s", chat_id)

    async def stop(self) -> None:
        logging.getLogger().removeHandler(self)
        self._active = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        pending: list[str] = []
        while not self._queue.empty():
            try:
                pending.append(self._queue.get_nowait())
                self._queue.task_done()
            except asyncio.QueueEmpty:
                break
        if self._coalesce_buf:
            pending.append(self._coalesce_buf.strip())
        self._coalesce_buf = ""
        self._coalesce_cnt = 0
        if pending:
            await self._do_send("\n".join(pending))
        logger.info("TelegramLogRelay stopped.")

    async def reset(self) -> None:
        global _recent_logs
        self._messages_sent = 0
        self._coalesce_buf = ""
        self._coalesce_cnt = 0
        self._recent_lines.clear()
        _recent_logs = ()
        self._last_edit_at = 0.0

    async def enqueue(self, text: str) -> None:
        if not self._active:
            return
        if self._messages_sent >= self._messages_limit:
            self._active = False
            try:
                self._queue.put_nowait(
                    f"Log display limit reached ({self._messages_limit} updates)."
                )
            except asyncio.QueueFull:
                pass
            return
        try:
            self._queue.put_nowait(text)
        except asyncio.QueueFull:
            logger.debug("Log relay queue full – message dropped.")

    async def _consumer(self) -> None:
        while self._active or not self._queue.empty():
            try:
                msg = await asyncio.wait_for(self._queue.get(), timeout=0.5)
                try:
                    if self._active:
                        await self._send_safe(msg)
                finally:
                    self._queue.task_done()
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
        if self._bot is None or self._admin_chat_id is None:
            return

        global _recent_logs
        self._recent_lines.append(text.replace("\x00", "")[:500])
        _recent_logs = tuple(self._recent_lines)
        active_view = _active_view
        if active_view != "main":
            return
        panel_text = _render_panel_content(active_view)

        try:
            if self._active:
                loop = asyncio.get_running_loop()
                delay = 1.1 - (loop.time() - self._last_edit_at)
                if delay > 0:
                    await asyncio.sleep(delay)
            await _edit_panel(
                chat_id=self._admin_chat_id,
                text=panel_text,
                reply_markup=get_main_kb(bot_settings),
            )
            self._last_edit_at = asyncio.get_running_loop().time()
            self._messages_sent += 1
        except Exception:
            logger.debug("Failed to update the Telegram status panel.", exc_info=True)

    def emit(self, record: logging.LogRecord) -> None:
        if not self._active or self._loop is None or record.name == logger.name:
            return

        text = self.format(record)

        def schedule_enqueue() -> None:
            if self._loop and self._loop.is_running():
                self._loop.create_task(self.enqueue(text))

        try:
            self._loop.call_soon_threadsafe(schedule_enqueue)
        except RuntimeError:
            self.handleError(record)


# ═════════════════════════════════════════════
# 3.  Deterministic keyboard builders
# ═════════════════════════════════════════════
def get_main_kb(settings: BotSettings) -> InlineKeyboardMarkup:
    text = _PANEL_TEXTS[settings.lang if settings.lang in _PANEL_TEXTS else "ru"]
    process_label = "stop_button" if settings.process_active else "start_button"
    process_callback = "cb_stop" if settings.process_active else "cb_start"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(
                text=text["stats_button"], callback_data="cb_stats",
            ), InlineKeyboardButton(
                text=text[process_label], callback_data=process_callback,
            )],
            [InlineKeyboardButton(
                text=text["input_button"], callback_data="cb_input_mode",
            ), InlineKeyboardButton(
                text=text["settings_button"], callback_data="cb_settings_mode",
            )],
        ],
    )


def get_settings_kb(settings: BotSettings) -> InlineKeyboardMarkup:
    lang = settings.lang if settings.lang in _PANEL_TEXTS else "ru"
    text = _PANEL_TEXTS[lang]
    language_callback = "cb_toggle_language"
    hints_label = "hints_hide_button" if settings.show_hints else "hints_show_button"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(
                text=text["language_button"], callback_data=language_callback,
            )],
            [InlineKeyboardButton(
                text=text[hints_label], callback_data="cb_toggle_hints",
            )],
            [InlineKeyboardButton(
                text=text["back_button"], callback_data="cb_back_to_main",
            )],
        ],
    )


def get_back_kb(settings: BotSettings) -> InlineKeyboardMarkup:
    text = _PANEL_TEXTS[settings.lang if settings.lang in _PANEL_TEXTS else "ru"]
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=text["back_button"], callback_data="cb_back_to_main"),
    ]])


# ═════════════════════════════════════════════
# 4.  Bot-wide state
# ═════════════════════════════════════════════
_log_relay = TelegramLogRelay()
_db: DatabaseManager | None = db
_bot: Bot | None = None
_admin_chat_id: int | None = None
_panel_chat_id: int | None = None
_panel_message_id: int | None = None
_process_lock = asyncio.Lock()


# ═════════════════════════════════════════════
# 5.  Router & Handlers
# ═════════════════════════════════════════════
admin_filter = AdminFilter()
router = Router()
router.message.filter(admin_filter)
router.callback_query.filter(admin_filter)
router.message.middleware(LocalizationMiddleware())
router.callback_query.middleware(LocalizationMiddleware())


# ── helpers: edit the persistent panel ────────
async def _reply(
    obj: Message | CallbackQuery,
    text: str,
    lang: str,
    parse_mode: str = "HTML",
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    global _active_view, _admin_chat_id, _panel_notice, _stats_snapshot
    bot_settings.lang = lang if lang in _PANEL_TEXTS else "ru"
    settings.CURRENT_BOT_LANG = bot_settings.lang
    _active_view = "main"
    _panel_notice = text
    _stats_snapshot = None
    rendered = _render_panel_content(_active_view)
    kb = reply_markup if reply_markup is not None else get_main_kb(bot_settings)
    if isinstance(obj, CallbackQuery):
        if isinstance(obj.message, Message):
            _admin_chat_id = obj.message.chat.id
            await _edit_panel(
                chat_id=obj.message.chat.id,
                message_id=obj.message.message_id,
                text=rendered,
                parse_mode=parse_mode,
                reply_markup=kb,
            )
    else:
        await _delete_user_message(obj)
        _admin_chat_id = obj.chat.id
        await _upsert_panel(
            chat_id=obj.chat.id,
            text=rendered,
            parse_mode=parse_mode,
            reply_markup=kb,
        )


async def _show_view(
    obj: Message | CallbackQuery,
    view_type: str,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    """Render a named view in the one persistent panel message."""
    global _active_view, _admin_chat_id

    _active_view = view_type
    text = _render_panel_content(view_type)
    if reply_markup is None:
        if view_type == "settings":
            reply_markup = get_settings_kb(bot_settings)
        elif view_type in {"input_screen", "stats", "input_result"}:
            reply_markup = get_back_kb(bot_settings)
        else:
            reply_markup = get_main_kb(bot_settings)

    if isinstance(obj, CallbackQuery):
        if isinstance(obj.message, Message):
            _admin_chat_id = obj.message.chat.id
            await _edit_panel(
                chat_id=obj.message.chat.id,
                message_id=obj.message.message_id,
                text=text,
                reply_markup=reply_markup,
            )
        return

    await _delete_user_message(obj)
    _admin_chat_id = obj.chat.id
    await _upsert_panel(
        chat_id=obj.chat.id,
        text=text,
        reply_markup=reply_markup,
    )


async def _delete_user_message(message: Message) -> None:
    try:
        await message.delete()
    except TelegramAPIError:
        logger.debug("Could not delete admin input message", exc_info=True)


async def _upsert_panel(
    *,
    chat_id: int,
    text: str,
    parse_mode: str = "HTML",
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    """Edit the existing control message, creating it only for the first screen."""
    global _panel_chat_id, _panel_message_id

    if _bot is None:
        raise RuntimeError("Bot is not initialized")

    if _panel_chat_id == chat_id and _panel_message_id is not None:
        try:
            await _bot.edit_message_text(
                chat_id=chat_id,
                message_id=_panel_message_id,
                text=text,
                parse_mode=parse_mode,
                reply_markup=reply_markup,
            )
            return
        except TelegramBadRequest as exc:
            if "message is not modified" in str(exc).lower():
                return
            error_text = str(exc).lower()
            if not any(
                marker in error_text
                for marker in ("message to edit not found", "message can't be edited")
            ):
                raise
            logger.info("Control message is no longer editable; creating a new panel")

    sent = await _bot.send_message(
        chat_id=chat_id,
        text=text,
        parse_mode=parse_mode,
        reply_markup=reply_markup,
    )
    _panel_chat_id = sent.chat.id
    _panel_message_id = sent.message_id


async def _edit_panel(
    *,
    chat_id: int,
    text: str,
    reply_markup: InlineKeyboardMarkup | None = None,
    parse_mode: str = "HTML",
    message_id: int | None = None,
) -> None:
    """Edit the active panel without creating additional Telegram messages."""
    global _panel_chat_id, _panel_message_id

    target_message_id = message_id or _panel_message_id
    if _bot is None or target_message_id is None:
        return
    if message_id is not None:
        _panel_chat_id = chat_id
        _panel_message_id = message_id
    if _panel_chat_id != chat_id:
        return
    try:
        await _bot.edit_message_text(
            chat_id=chat_id,
            message_id=target_message_id,
            text=text,
            parse_mode=parse_mode,
            reply_markup=reply_markup,
        )
    except TelegramBadRequest as exc:
        if "message is not modified" not in str(exc).lower():
            raise


# ── /start ───────────────────────────────────
@router.message(CommandStart())
async def cmd_start(message: Message, lang: str, state: FSMContext) -> None:
    global _panel_notice, _stats_snapshot
    await state.clear()
    bot_settings.lang = lang if lang in _PANEL_TEXTS else "ru"
    settings.CURRENT_BOT_LANG = bot_settings.lang
    _panel_notice = None
    _stats_snapshot = None
    await _show_view(message, "main")


@router.callback_query(F.data == "cb_settings_mode")
async def open_settings(callback: CallbackQuery, state: FSMContext) -> None:
    global _panel_notice
    await callback.answer()
    await state.clear()
    _panel_notice = None
    await _show_view(callback, "settings")


@router.callback_query(F.data == "cb_toggle_language")
async def set_language(callback: CallbackQuery, state: FSMContext) -> None:
    global _panel_notice
    await callback.answer()
    await state.clear()
    bot_settings.lang = "en" if bot_settings.lang == "ru" else "ru"
    settings.CURRENT_BOT_LANG = bot_settings.lang
    _panel_notice = None
    await _show_view(callback, "settings")


@router.callback_query(F.data == "cb_toggle_hints")
async def toggle_hints(callback: CallbackQuery, state: FSMContext) -> None:
    global _panel_notice
    await callback.answer()
    await state.clear()
    bot_settings.show_hints = not bot_settings.show_hints
    _panel_notice = None
    await _show_view(callback, "settings")


@router.message(Command("language"))
async def cmd_toggle_language(
    message: Message,
    lang: str,
    state: FSMContext,
) -> None:
    global _panel_notice
    await state.clear()
    bot_settings.lang = "en" if lang == "ru" else "ru"
    settings.CURRENT_BOT_LANG = bot_settings.lang
    _panel_notice = None
    await _show_view(message, "settings")


@router.callback_query(F.data == "cb_back_to_main")
async def back_to_main(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    global _panel_notice, _stats_snapshot
    await callback.answer()
    await state.clear()
    _panel_notice = None
    _stats_snapshot = None
    await _show_view(callback, "main")


# ── /help ────────────────────────────────────
@router.message(Command("help"))
@router.callback_query(F.data == "help")
async def cmd_help(
    obj: Message | CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    if isinstance(obj, CallbackQuery):
        await obj.answer()
    await state.clear()
    help_text = localization.get_text(lang, "help_text")
    await _reply(
        obj,
        help_text,
        lang,
    )


# ── /launch / Launch callback ────────────────
@router.message(Command("launch"))
async def cmd_launch(
    obj: Message,
    lang: str,
    state: FSMContext,
) -> None:
    await state.clear()
    await _start_farm(obj, lang)


@router.callback_query(F.data == "cb_start")
async def start_process_callback(
    callback: CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    await callback.answer()
    await state.clear()
    await _start_farm(callback, lang)


@router.callback_query(F.data == "cb_stop")
async def stop_process_callback(
    callback: CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    await callback.answer()
    await state.clear()
    result = await _stop_farm(lang)
    await _reply(callback, result, lang)


async def _start_farm(obj: Message | CallbackQuery, lang: str) -> None:
    async with _process_lock:
        await _start_farm_locked(obj, lang)


async def _start_farm_locked(obj: Message | CallbackQuery, lang: str) -> None:
    global _orchestrator_task, _panel_notice

    if bot_settings.process_active:
        await _reply(obj, localization.get_text(lang, "already_running"), lang)
        return

    try:
        # Touch the shared manager once to fail early on a database problem.
        await db.get_total_accounts_count()
    except Exception:
        logger.exception("Failed to connect to the database before starting")
        await _reply(obj, localization.get_text(lang, "db_query_error"), lang)
        return

    if not BOT_USERNAME:
        await _reply(obj, localization.get_text(lang, "bot_username_missing"), lang)
        return

    chat_id = obj.chat.id if isinstance(obj, Message) else obj.message.chat.id
    global _admin_chat_id
    _admin_chat_id = chat_id
    await _log_relay.reset()
    bot_settings.process_active = True
    _panel_notice = None

    try:
        await _reply(
            obj,
            f"{localization.get_text(lang, 'launch_started')}\n"
            f"{localization.get_text(lang, 'launch_progress')}",
            lang,
        )
    except Exception:
        bot_settings.process_active = False
        raise

    if _bot is not None:
        await _log_relay.start(_bot, chat_id)
    await _log_relay.enqueue("🚀 Farm run initiated …")

    _orchestrator_task = asyncio.create_task(
        _run_farm_in_background(BOT_USERNAME),
        name="farm-orchestrator",
    )


async def _stop_farm(lang: str) -> str:
    async with _process_lock:
        return await _stop_farm_locked(lang)


async def _stop_farm_locked(lang: str) -> str:
    global _orchestrator_task

    task = _orchestrator_task
    if not bot_settings.process_active or task is None or task.done():
        bot_settings.process_active = False
        return localization.get_text(lang, "process_status_stopped")

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    finally:
        bot_settings.process_active = False
        if _orchestrator_task is task:
            _orchestrator_task = None
        try:
            await _log_relay.stop()
        except Exception:
            logger.exception("Failed to stop the Telegram log relay")
    if task.cancelled():
        return localization.get_text(lang, "process_stopped")
    return localization.get_text(lang, "launch_completed")


# ── /stats / Dashboard callback ──────────────
@router.message(Command("stats"))
@router.callback_query(F.data == "cb_stats")
async def cmd_stats(
    obj: Message | CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    global _panel_notice, _stats_snapshot
    if isinstance(obj, CallbackQuery):
        await obj.answer()
    await state.clear()
    global db
    try:
        total, active, banned, on_hold = await asyncio.gather(
            db.get_total_accounts_count(),
            db.get_accounts_count_by_status("Active"),
            db.get_accounts_count_by_status("Banned"),
            db.get_accounts_count_by_status("On_Hold"),
        )
        stats = {
            "total": total,
            "active": active,
            "banned": banned,
            "on_hold": on_hold,
        }
    except Exception as exc:
        logger.error("Failed to get stats: %s", exc)
        _stats_snapshot = None
        _panel_notice = localization.get_text(lang, "db_query_error")
        await _show_view(obj, "stats")
        return

    _stats_snapshot = stats
    _panel_notice = None
    await _show_view(obj, "stats")


# ── /import ──────────────────────────────────
@router.message(Command("import"))
@router.callback_query(F.data == "import")
async def cmd_import(
    obj: Message | CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    global _panel_notice
    if isinstance(obj, CallbackQuery):
        await obj.answer()
    await state.clear()
    _panel_notice = localization.get_text(lang, "import_instruction")
    await _reply(obj, _panel_notice, lang)


@router.callback_query(F.data == "cb_input_mode")
async def open_input_mode(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await callback.answer()
    if not isinstance(callback.message, Message):
        return

    global _panel_notice
    _panel_notice = None
    await state.set_state(MenuStates.waiting_for_text)
    await state.update_data(menu_msg_id=callback.message.message_id)
    await _show_view(callback, "input_screen")


@router.message(MenuStates.waiting_for_text, F.text)
async def receive_text(message: Message, state: FSMContext) -> None:
    global _active_view, _panel_notice

    await _delete_user_message(message)

    data = await state.get_data()
    menu_msg_id = data.get("menu_msg_id")
    if menu_msg_id is None:
        await state.clear()
        return

    lang = bot_settings.lang if bot_settings.lang in _PANEL_TEXTS else "ru"
    text = _PANEL_TEXTS[lang]
    payload = (message.text or "").strip()
    parts = payload.split("|", maxsplit=1)
    phone = parts[0].strip()
    proxy = parts[1].strip() if len(parts) == 2 else ""

    _active_view = "input_result"
    if not phone:
        _panel_notice = text["input_invalid"]
    else:
        clean_phone = phone.replace("+", "").replace(" ", "").replace("-", "")
        target_session_name = f"session_{clean_phone}"
        new_worker = Account(
            session_name=target_session_name,
            phone_number=phone,
            proxy_string=proxy,
            account_status="Active",
        )
        try:
            await db.save_account(new_worker)
            _panel_notice = (
                f"{text['input_saved']}\n\n"
                f"{text['session_instruction'].format(session_name=html.escape(target_session_name))}"
            )
        except Exception:
            logger.exception("Failed to save account parameters")
            _panel_notice = text["input_save_failed"]

    try:
        await _edit_panel(
            chat_id=message.chat.id,
            message_id=menu_msg_id,
            text=_render_panel_content(_active_view),
            reply_markup=get_back_kb(bot_settings),
        )
    finally:
        await state.clear()


# ── File upload handler ──────────────────────
@router.message()
async def handle_file_upload(
    message: Message,
    lang: str,
    state: FSMContext,
) -> None:
    """Accept .session, .csv, .txt, .json files from admin."""
    global _db

    if not message.document:
        await _delete_user_message(message)
        return

    await _delete_user_message(message)

    import shutil
    import tempfile

    doc = message.document
    ext = Path(doc.file_name).suffix.lower() if doc.file_name else ""
    safe_filename = Path((doc.file_name or "uploaded_file").replace("\\", "/")).name

    ALLOWED_EXTS = {".session", ".csv", ".txt", ".json"}
    if ext not in ALLOWED_EXTS:
        await state.clear()
        await _reply(
            message,
            localization.get_text(lang, "unsupported_file"),
            lang,
        )
        return

    temp_dir = Path(LOG_DIR).parent / "temp_imports"
    temp_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False, dir=temp_dir) as tmp:
        tmp_path = Path(tmp.name)

    try:
        if _bot is None:
            raise RuntimeError("Bot is not initialized")
        await _bot.download(doc, destination=tmp_path)
        await state.clear()

        if _db is None:
            _db = DatabaseManager()
            await _db.connect()

        if ext in (".csv", ".txt"):
            phones = _read_phones_from_file(tmp_path)
            imported = await _db.import_phone_numbers(phones)
            msg = (
                f"✅ Imported {imported} account(s) from "
                f"{html.escape(safe_filename)}."
            )
        elif ext == ".json":
            imported = await _db.import_json_file(str(tmp_path))
            msg = (
                f"✅ Imported {imported} account(s) from "
                f"{html.escape(safe_filename)}."
            )
        else:
            # .session – copy to sessions dir
            sessions_dir = Path(LOG_DIR).parent / "sessions"
            sessions_dir.mkdir(parents=True, exist_ok=True)
            dest = sessions_dir / safe_filename
            shutil.copy2(str(tmp_path), str(dest))
            msg = f"✅ Session file saved to sessions directory."

        await _reply(message, msg, lang)

    except Exception as exc:
        logger.exception("File import failed: %s", exc)
        await state.clear()
        await _reply(
            message,
            localization.get_text(lang, "import_failed").format(
                error=html.escape(str(exc)),
            ),
            lang,
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
    global _active_view, _orchestrator_task, _panel_notice
    logger.info("Background farm run started.")
    final_text = localization.get_text(
        bot_settings.lang,
        "launch_completed",
    )
    try:
        await orchestrator.start_all_sessions()

        await _log_relay.enqueue("✅ Farm run completed successfully.")
    except asyncio.CancelledError:
        final_text = localization.get_text(
            bot_settings.lang,
            "process_stopped",
        )
        logger.info("Background farm run was stopped by the administrator.")
        raise
    except Exception as exc:
        logger.exception("Farm run failed: %s", exc)
        await _log_relay.enqueue(f"❌ Farm run failed: {exc}")
        final_text = localization.get_text(
            bot_settings.lang,
            "launch_failed",
        ).format(error=html.escape(str(exc)))
    finally:
        bot_settings.process_active = False
        _panel_notice = final_text
        _active_view = "main"
        try:
            await _log_relay.stop()
        except Exception:
            logger.exception("Failed to stop the Telegram log relay")
        if _admin_chat_id is not None:
            try:
                await _edit_panel(
                    chat_id=_admin_chat_id,
                    text=_render_panel_content("main"),
                    reply_markup=get_main_kb(bot_settings),
                )
            except TelegramAPIError:
                logger.info("Could not update the panel after process completion")
        if _orchestrator_task is asyncio.current_task():
            _orchestrator_task = None
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
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(router)

    logger.info("Starting polling …")
    try:
        await dp.start_polling(_bot)
    except KeyboardInterrupt:
        logger.info("Bot stopped by keyboard interrupt.")
    except Exception as exc:
        logger.critical("Bot crashed: %s", exc)
    finally:
        if _orchestrator_task and not _orchestrator_task.done():
            _orchestrator_task.cancel()
            await asyncio.gather(_orchestrator_task, return_exceptions=True)
        await _log_relay.stop()
        if _db is not None:
            try:
                await _db.close()
            except Exception:
                logger.exception("Failed to close database connection")
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
