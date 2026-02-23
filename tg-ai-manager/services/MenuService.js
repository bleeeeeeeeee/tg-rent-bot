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
}

module.exports = MenuService;