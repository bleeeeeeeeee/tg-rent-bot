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
                    [{ text: "📢 Опубликовать сейчас", callback_data: `draft_publish_now_${draftId}` }],
                    [{ text: "⏳ Позже", callback_data: `draft_publish_delay_${draftId}` }],
                    [{ text: "❌ Удалить", callback_data: `draft_delete_${draftId}` }],
                    [{ text: "↩️ Отмена", callback_data: "draft_cancel" }]
                ]
            }
        };
    }
}

module.exports = MenuService;