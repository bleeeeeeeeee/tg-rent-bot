class MenuService {
    static getMainMenu() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📢 Публикация", callback_data: "menu_publish" }],
                    [{ text: "📝 Черновики", callback_data: "menu_drafts" }]
                ]
            }
        };
    }

    static getPostActionMenu() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📢 Опубликовать сейчас", callback_data: "publish_now" }],
                    [{ text: "⏳ Позже", callback_data: "publish_delay" }],
                    [{ text: "📝 В черновики", callback_data: "save_draft" }],
                    [{ text: "❌ Отмена", callback_data: "cancel" }]
                ]
            }
        };
    }

    static getDraftsMenu(drafts) {
        const keyboard = drafts.map((d, idx) => [
            { text: `✏️ Черновик ${idx + 1}`, callback_data: `draft_select_${d.id}` }
        ]);
        // add navigation back to main menu
        keyboard.push([{ text: '↩️ Главное меню', callback_data: 'cancel' }]);
        return {
            reply_markup: {
                inline_keyboard: keyboard
            }
        };
    }

    static getDraftActionMenu(draftId) {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✏️ Изменить", callback_data: `draft_edit_${draftId}` }],
                    [{ text: "📢 Опубликовать сейчас", callback_data: `draft_publish_now_${draftId}` }],
                    [{ text: "⏳ Позже", callback_data: `draft_publish_delay_${draftId}` }],
                    [{ text: "❌ Удалить", callback_data: `draft_delete_${draftId}` }],
                    [{ text: "↩️ Отмена", callback_data: "draft_cancel" }]
                ]
            }
        };
    }

    static getCalendar(year, month) {
        const date = new Date(year, month, 1);
        const startDay = date.getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const rows = [];
        let day = 1;
        for (let week = 0; week < 6; week++) {
            const row = [];
            for (let d = 0; d < 7; d++) {
                if (week === 0 && d < startDay) {
                    row.push({ text: ' ', callback_data: 'noop' });
                } else if (day > daysInMonth) {
                    row.push({ text: ' ', callback_data: 'noop' });
                } else {
                    const dayStr = String(day).padStart(2, '0');
                    row.push({ text: dayStr, callback_data: `calendar_${year}-${String(month+1).padStart(2,'0')}-${dayStr}` });
                    day++;
                }
            }
            rows.push(row);
            if (day > daysInMonth) break;
        }
        // navigation row: previous month, label, next month
        const prev = new Date(year, month - 1, 1);
        const next = new Date(year, month + 1, 1);
        const nav = [
            { text: '<', callback_data: `calendar_prev_${prev.getFullYear()}-${prev.getMonth()}` },
            { text: `${year}-${String(month+1).padStart(2,'0')}`, callback_data: 'noop' },
            { text: '>', callback_data: `calendar_next_${next.getFullYear()}-${next.getMonth()}` }
        ];
        rows.unshift(nav);
        return { reply_markup: { inline_keyboard: rows } };
    }
}

module.exports = MenuService;