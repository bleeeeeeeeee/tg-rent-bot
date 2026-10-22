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
from database.db_manager import DatabaseManager
from utils.localization import LocalizationManager

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────
LOG_RELAY_QUEUE_SIZE = 256
ORCH_MAX_MSGS = 150
localization = LocalizationManager()

logger = logging.getLogger("admin_bot")


@dataclass(slots=True)
class RuntimeState:
    """Runtime configuration and the transient data shown in the panel."""

    lang: str = "ru"
    show_hints: bool = True
    is_processing: bool = False
    stats: dict[str, int] | None = None
    notice: str | None = None
    recent_logs: tuple[str, ...] = ()
    view: str = "main"


runtime_state = RuntimeState()
settings.CURRENT_BOT_LANG = runtime_state.lang

_PANEL_TEXTS = {
    "ru": {
        "main_title": "⚙️ Панель администратора",
        "status_label": "Состояние",
        "status_running": "процесс запущен",
        "status_stopped": "процесс остановлен",
        "main_hint": "Используйте кнопки ниже для управления процессом.",
        "settings_title": "⚙️ Настройки интерфейса",
        "settings_language": "Язык интерфейса",
        "settings_hints": "Справочные инструкции",
        "hints_shown": "показываются",
        "hints_hidden": "скрыты",
        "input_instruction": (
            "<b>📥 Ввод параметров</b>\n\n"
            "Отправьте строку в формате:\n"
            "<code>Значение_1 | Значение_2</code>"
        ),
        "input_invalid": (
            "❌ Неверный формат. Отправьте ровно два значения через символ |."
        ),
        "input_empty": "❌ Оба значения должны быть заполнены.",
        "input_save_failed": "❌ Не удалось сохранить данные. Попробуйте ещё раз.",
        "input_saved": (
            "<b>✅ Параметры сохранены</b>\n\n"
            "<b>Значение 1:</b> {param_1}\n"
            "<b>Значение 2:</b> {param_2}"
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
        "settings_switch_language": "🌐 Язык: RU → EN",
        "settings_switch_language_en": "🌐 Language: EN → RU",
        "settings_hide_hints": "📖 Инструкции: Скрыть",
        "settings_show_hints": "📖 Инструкции: Показать",
        "back": "↩️ Назад в меню",
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
        "main_hint": "Use the buttons below to manage the process.",
        "settings_title": "⚙️ Interface settings",
        "settings_language": "Interface language",
        "settings_hints": "Help instructions",
        "hints_shown": "shown",
        "hints_hidden": "hidden",
        "input_instruction": (
            "<b>📥 Enter parameters</b>\n\n"
            "Send one line in this format:\n"
            "<code>Value_1 | Value_2</code>"
        ),
        "input_invalid": (
            "❌ Invalid format. Send exactly two values separated by |."
        ),
        "input_empty": "❌ Both values are required.",
        "input_save_failed": "❌ Could not save the data. Please try again.",
        "input_saved": (
            "<b>✅ Parameters saved</b>\n\n"
            "<b>Value 1:</b> {param_1}\n"
            "<b>Value 2:</b> {param_2}"
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
        "settings_switch_language": "🌐 Language: RU → EN",
        "settings_switch_language_en": "🌐 Language: EN → RU",
        "settings_hide_hints": "📖 Instructions: Hide",
        "settings_show_hints": "📖 Instructions: Show",
        "back": "↩️ Back to menu",
        "stats_button": "📊 Statistics",
        "start_button": "🚀 Start process",
        "stop_button": "🛑 Stop process",
        "input_button": "📥 Enter parameters",
        "settings_button": "⚙️ Settings",
        "cancel_button": "❌ Cancel",
        "logs_title": "<b>Recent activity</b>",
    },
}


def get_panel_content(view_type: str, state: RuntimeState) -> str:
    """Render a complete HTML panel screen for the requested view."""
    lang = state.lang if state.lang in _PANEL_TEXTS else "ru"
    text = _PANEL_TEXTS[lang]

    if view_type == "main":
        status_key = "status_running" if state.is_processing else "status_stopped"
        sections = [
            f"<b>{text['main_title']}</b>",
            f"{text['status_label']}: <b>{text[status_key]}</b>.",
        ]
        if state.notice:
            sections.append(state.notice)
        if state.recent_logs:
            raw_logs = "\n".join(state.recent_logs)[-550:]
            log_text = html.escape(raw_logs)
            sections.append(f"{text['logs_title']}\n<pre>{log_text}</pre>")
        if state.show_hints:
            sections.append(f"<i>{text['main_hint']}</i>")
        return "\n\n".join(sections)

    if view_type == "settings":
        language_name = "Русский" if lang == "ru" else "English"
        hints_status = text["hints_shown"] if state.show_hints else text["hints_hidden"]
        return (
            f"<b>{text['settings_title']}</b>\n\n"
            f"🌐 {text['settings_language']}: <b>{language_name}</b>\n"
            f"📖 {text['settings_hints']}: <b>{hints_status}</b>"
        )

    if view_type == "input":
        sections = [text["input_instruction"]]
        if state.notice:
            sections.append(state.notice)
        return "\n\n".join(sections)

    if view_type == "stats":
        lines = [f"<b>{text['stats_title']}</b>"]
        if state.notice:
            lines.append(state.notice)
        elif state.stats is None:
            lines.append(text["stats_unavailable"])
        else:
            rows = (
                ("total", "stats_total"),
                ("active", "stats_active"),
                ("banned", "stats_banned"),
                ("spamblock", "stats_spamblock"),
                ("on_hold", "stats_on_hold"),
                ("with_proxy", "stats_proxy"),
                ("wallets_bound", "stats_wallets"),
            )
            lines.extend(
                f"{text[label]}: <b>{html.escape(str(state.stats.get(key, 0)))}</b>"
                for key, label in rows
            )
        return "\n\n".join(lines)

    raise ValueError(f"Unsupported panel view: {view_type!r}")


# ═════════════════════════════════════════════
# 1.  Localization Middleware
# ═════════════════════════════════════════════
class LocalizationMiddleware(BaseMiddleware):
    """Expose the current interface language to each handler as ``lang``."""

    async def __call__(self, handler, event, data):
        data["lang"] = runtime_state.lang
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


class PanelStates(StatesGroup):
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
        self._messages_sent = 0
        self._coalesce_buf = ""
        self._coalesce_cnt = 0
        self._recent_lines.clear()
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

        self._recent_lines.append(text.replace("\x00", "")[:500])
        runtime_state.recent_logs = tuple(self._recent_lines)
        active_view = runtime_state.view
        panel_text = get_panel_content(active_view, runtime_state)

        try:
            if self._active:
                loop = asyncio.get_running_loop()
                delay = 1.1 - (loop.time() - self._last_edit_at)
                if delay > 0:
                    await asyncio.sleep(delay)
            await _edit_panel(
                chat_id=self._admin_chat_id,
                text=panel_text,
                reply_markup=_keyboard_for_view(active_view),
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
# 3.  Deterministic keyboard and panel builders
# ═════════════════════════════════════════════
def get_main_kb(state: RuntimeState) -> InlineKeyboardMarkup:
    text = _PANEL_TEXTS[state.lang if state.lang in _PANEL_TEXTS else "ru"]
    process_label = "stop_button" if state.is_processing else "start_button"
    process_callback = "proc_stop" if state.is_processing else "proc_start"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(
                text=text["stats_button"], callback_data="stats",
            ), InlineKeyboardButton(
                text=text[process_label], callback_data=process_callback,
            )],
            [InlineKeyboardButton(
                text=text["input_button"], callback_data="menu_input",
            ), InlineKeyboardButton(
                text=text["settings_button"], callback_data="menu_settings",
            )],
        ],
    )


def get_settings_kb(state: RuntimeState) -> InlineKeyboardMarkup:
    lang = state.lang if state.lang in _PANEL_TEXTS else "ru"
    text = _PANEL_TEXTS[lang]
    language_callback = "set_lang_en" if lang == "ru" else "set_lang_ru"
    language_label = (
        "settings_switch_language" if lang == "ru"
        else "settings_switch_language_en"
    )
    hints_label = "settings_hide_hints" if state.show_hints else "settings_show_hints"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(
                text=text[language_label], callback_data=language_callback,
            )],
            [InlineKeyboardButton(
                text=text[hints_label], callback_data="toggle_hints",
            )],
            [InlineKeyboardButton(
                text=text["back"], callback_data="back_to_main",
            )],
        ],
    )


def get_input_kb(state: RuntimeState) -> InlineKeyboardMarkup:
    text = _PANEL_TEXTS[state.lang if state.lang in _PANEL_TEXTS else "ru"]
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=text["cancel_button"], callback_data="cancel_input"),
    ]])


def _keyboard_for_view(view_type: str) -> InlineKeyboardMarkup:
    if view_type == "settings":
        return get_settings_kb(runtime_state)
    if view_type == "input":
        return get_input_kb(runtime_state)
    return get_main_kb(runtime_state)


# ═════════════════════════════════════════════
# 4.  Bot-wide state
# ═════════════════════════════════════════════
_log_relay = TelegramLogRelay()
_orchestrator_task: asyncio.Task | None = None
_db: DatabaseManager | None = None
_bot: Bot | None = None
_admin_chat_id: int | None = None
_panel_chat_id: int | None = None
_panel_message_id: int | None = None
_saved_parameters: tuple[str, str] | None = None
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
    global _admin_chat_id
    runtime_state.lang = lang if lang in _PANEL_TEXTS else "ru"
    runtime_state.view = "main"
    runtime_state.notice = text
    runtime_state.stats = None
    rendered = get_panel_content("main", runtime_state)
    kb = reply_markup if reply_markup is not None else get_main_kb(runtime_state)
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
    global _admin_chat_id

    runtime_state.view = view_type
    text = get_panel_content(view_type, runtime_state)
    if reply_markup is None:
        if view_type == "settings":
            reply_markup = get_settings_kb(runtime_state)
        elif view_type == "input":
            reply_markup = get_input_kb(runtime_state)
        else:
            reply_markup = get_main_kb(runtime_state)

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
    await state.clear()
    runtime_state.lang = lang if lang in _PANEL_TEXTS else "ru"
    runtime_state.notice = None
    runtime_state.stats = None
    await _show_view(message, "main")


@router.callback_query(F.data == "menu_settings")
async def open_settings(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    runtime_state.notice = None
    await _show_view(callback, "settings")


@router.callback_query(F.data.in_({"set_lang_ru", "set_lang_en"}))
async def set_language(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    runtime_state.lang = "ru" if callback.data == "set_lang_ru" else "en"
    settings.CURRENT_BOT_LANG = runtime_state.lang
    runtime_state.notice = None
    await _show_view(callback, "settings")


@router.callback_query(F.data == "toggle_hints")
async def toggle_hints(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    runtime_state.show_hints = not runtime_state.show_hints
    runtime_state.notice = None
    await _show_view(callback, "settings")


@router.message(Command("language"))
async def cmd_toggle_language(
    message: Message,
    lang: str,
    state: FSMContext,
) -> None:
    await state.clear()
    runtime_state.lang = "en" if lang == "ru" else "ru"
    settings.CURRENT_BOT_LANG = runtime_state.lang
    runtime_state.notice = None
    await _show_view(message, "settings")


@router.callback_query(F.data == "back_to_main")
async def back_to_main(
    callback: CallbackQuery,
    state: FSMContext,
) -> None:
    await callback.answer()
    await state.clear()
    runtime_state.notice = None
    runtime_state.stats = None
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
    runtime_state.notice = localization.get_text(lang, "help_text")
    await _reply(
        obj,
        runtime_state.notice,
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


@router.callback_query(F.data == "proc_start")
async def start_process_callback(
    callback: CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    await callback.answer()
    await state.clear()
    await _start_farm(callback, lang)


@router.callback_query(F.data == "proc_stop")
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
    global _orchestrator_task, _db

    if runtime_state.is_processing:
        await _reply(obj, localization.get_text(lang, "already_running"), lang)
        return

    try:
        if _db is None:
            _db = DatabaseManager()
            await _db.connect()
    except Exception:
        logger.exception("Failed to connect to the database before starting")
        _db = None
        await _reply(obj, localization.get_text(lang, "db_query_error"), lang)
        return

    if not BOT_USERNAME:
        await _reply(obj, localization.get_text(lang, "bot_username_missing"), lang)
        return

    chat_id = obj.chat.id if isinstance(obj, Message) else obj.message.chat.id
    global _admin_chat_id
    _admin_chat_id = chat_id
    await _log_relay.reset()
    runtime_state.is_processing = True
    runtime_state.notice = None

    try:
        await _reply(
            obj,
            f"{localization.get_text(lang, 'launch_started')}\n"
            f"{localization.get_text(lang, 'launch_progress')}",
            lang,
        )
    except Exception:
        runtime_state.is_processing = False
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
    if not runtime_state.is_processing or task is None or task.done():
        runtime_state.is_processing = False
        return localization.get_text(lang, "process_status_stopped")

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    finally:
        runtime_state.is_processing = False
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
@router.callback_query(F.data == "stats")
async def cmd_stats(
    obj: Message | CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    if isinstance(obj, CallbackQuery):
        await obj.answer()
    await state.clear()
    global _db
    try:
        if _db is None:
            _db = DatabaseManager()
            await _db.connect()
        stats = await _db.get_stats()
    except Exception as exc:
        logger.error("Failed to get stats: %s", exc)
        _db = None
        runtime_state.stats = None
        runtime_state.notice = localization.get_text(lang, "db_query_error")
        await _show_view(obj, "stats")
        return

    runtime_state.stats = stats
    runtime_state.notice = None
    await _show_view(obj, "stats")


# ── /import ──────────────────────────────────
@router.message(Command("import"))
@router.callback_query(F.data == "import")
async def cmd_import(
    obj: Message | CallbackQuery,
    lang: str,
    state: FSMContext,
) -> None:
    if isinstance(obj, CallbackQuery):
        await obj.answer()
    await state.clear()
    runtime_state.notice = localization.get_text(lang, "import_instruction")
    await _reply(obj, runtime_state.notice, lang)


@router.callback_query(F.data == "menu_input")
async def request_parameters(
    callback: CallbackQuery,
    state: FSMContext,
    lang: str,
) -> None:
    await callback.answer()
    if not isinstance(callback.message, Message):
        return

    runtime_state.notice = None
    await state.set_state(PanelStates.waiting_for_text)
    await state.update_data(panel_msg_id=callback.message.message_id)
    await _show_view(callback, "input")


@router.callback_query(F.data == "cancel_input")
async def cancel_input(
    callback: CallbackQuery,
    state: FSMContext,
    lang: str,
) -> None:
    await callback.answer()
    await state.clear()
    runtime_state.notice = None
    await _show_view(callback, "main")


async def db_save(param_1: str, param_2: str) -> None:
    """Persistence integration point; replace this stub with the project DB write."""
    pass


@router.message(PanelStates.waiting_for_text, F.text)
async def save_parameters(message: Message, state: FSMContext, lang: str) -> None:
    global _saved_parameters

    # Remove the submitted message before doing any parsing or persistence.
    await _delete_user_message(message)

    data = await state.get_data()
    panel_msg_id = data.get("panel_msg_id")
    if panel_msg_id is None:
        await state.clear()
        return

    parts = message.text.split("|")
    if len(parts) != 2:
        runtime_state.notice = _PANEL_TEXTS[runtime_state.lang]["input_invalid"]
        await _edit_panel(
            chat_id=message.chat.id,
            message_id=panel_msg_id,
            text=get_panel_content("input", runtime_state),
            reply_markup=get_input_kb(runtime_state),
        )
        return

    param_1, param_2 = (part.strip() for part in parts)
    if not param_1 or not param_2:
        runtime_state.notice = _PANEL_TEXTS[runtime_state.lang]["input_empty"]
        await _edit_panel(
            chat_id=message.chat.id,
            message_id=panel_msg_id,
            text=get_panel_content("input", runtime_state),
            reply_markup=get_input_kb(runtime_state),
        )
        return

    if len(param_1) + len(param_2) > 650:
        runtime_state.notice = localization.get_text(lang, "input_too_long")
        await _edit_panel(
            chat_id=message.chat.id,
            message_id=panel_msg_id,
            text=get_panel_content("input", runtime_state),
            reply_markup=get_input_kb(runtime_state),
        )
        return

    try:
        await db_save(param_1, param_2)
    except Exception:
        logger.exception("Failed to save panel parameters")
        runtime_state.notice = _PANEL_TEXTS[runtime_state.lang]["input_save_failed"]
        await _edit_panel(
            chat_id=message.chat.id,
            message_id=panel_msg_id,
            text=get_panel_content("input", runtime_state),
            reply_markup=get_input_kb(runtime_state),
        )
        return

    _saved_parameters = (param_1, param_2)
    runtime_state.stats = None
    runtime_state.view = "main"
    runtime_state.notice = _PANEL_TEXTS[runtime_state.lang]["input_saved"].format(
        param_1=html.escape(param_1),
        param_2=html.escape(param_2),
    )
    await _edit_panel(
        chat_id=message.chat.id,
        message_id=panel_msg_id,
        text=get_panel_content("main", runtime_state),
        reply_markup=get_main_kb(runtime_state),
    )
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
    global _orchestrator_task
    logger.info("Background farm run started.")
    final_text = localization.get_text(
        runtime_state.lang,
        "launch_completed",
    )
    try:
        from orchestrator import run_orchestrator

        await run_orchestrator(bot_username)

        await _log_relay.enqueue("✅ Farm run completed successfully.")
    except asyncio.CancelledError:
        final_text = localization.get_text(
            runtime_state.lang,
            "process_stopped",
        )
        logger.info("Background farm run was stopped by the administrator.")
        raise
    except Exception as exc:
        logger.exception("Farm run failed: %s", exc)
        await _log_relay.enqueue(f"❌ Farm run failed: {exc}")
        final_text = localization.get_text(
            runtime_state.lang,
            "launch_failed",
        ).format(error=html.escape(str(exc)))
    finally:
        runtime_state.is_processing = False
        runtime_state.notice = final_text
        runtime_state.view = "main"
        try:
            await _log_relay.stop()
        except Exception:
            logger.exception("Failed to stop the Telegram log relay")
        if _admin_chat_id is not None:
            try:
                await _edit_panel(
                    chat_id=_admin_chat_id,
                    text=get_panel_content("main", runtime_state),
                    reply_markup=get_main_kb(runtime_state),
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
