const AiProviderRegistry = require('../ai/AiProviderRegistry');
const SettingsService = require('./SettingsService');
const SecretsService = require('./SecretsService');

class SettingsUIService {
  static async formatSettingsRoot() {
    const tz = await SettingsService.getTimezone();
    const autoEnrich = await SettingsService.getAutoEnrich();
    const chatCleanup = await SettingsService.getChatCleanup();
    const active = await SettingsService.getActiveProvider();
    let aiLine = 'Нейросеть: не подключена';

    if (active) {
      const secrets = await SecretsService.getProviderSecret(active);
      if (AiProviderRegistry.isConfigured(active, secrets)) {
        aiLine = `Нейросеть: ${AiProviderRegistry.getLabel(active)}`;
      }
    }

    return (
      `⚙️ <b>Настройки</b>\n\n` +
      `${aiLine}\n` +
      `Автоанализ новых постов: ${autoEnrich ? 'включён' : 'выключен'}\n` +
      `Очистка чата: ${chatCleanup ? 'включена' : 'выключена'}\n` +
      `Часовой пояс: ${tz}\n\n` +
      `Справка по боту — кнопка «Инструкция» ниже.`
    );
  }

  static async formatAiScreen() {
    const active = await SettingsService.getActiveProvider();
    const autoEnrich = await SettingsService.getAutoEnrich();
    const configured = [];

    for (const p of AiProviderRegistry.listAll()) {
      const secrets = await SecretsService.getProviderSecret(p.id);
      if (AiProviderRegistry.isConfigured(p.id, secrets)) {
        configured.push(p);
      }
    }

    let lines = ['🤖 <b>ИИ для постов</b>', ''];
    lines.push('Нейросеть создаёт заголовок, суть, теги и категорию для каждого поста.', '');

    if (active && configured.some((p) => p.id === active)) {
      const model = await SettingsService.getModel(active);
      lines.push(`Активна: <b>${AiProviderRegistry.getLabel(active)}</b>`);
      if (model) lines.push(`Модель: <code>${model}</code>`);
    } else if (configured.length > 0) {
      lines.push('Сервис не выбран — укажите, какую нейросеть использовать.');
    } else {
      lines.push('Нет подключённых сервисов. Нажмите «Подключить сервис».');
    }

    lines.push(`Автоанализ: <b>${autoEnrich ? 'включён' : 'выключен'}</b>`);
    lines.push(`Подключено сервисов: ${configured.length}`);

    return lines.join('\n');
  }

  static async formatAppearanceScreen(ui) {
    const useEmojis = ui?.useEmojis !== false;
    const navStyle = ui?.navStyle === 'arrows' ? 'arrows' : 'text';
    const navExample =
      navStyle === 'arrows'
        ? (useEmojis ? '← · ☰ · →' : '← · ☰ · →')
        : (useEmojis ? '← Назад · К шагам · Далее →' : 'Назад · К шагам · Далее');
    return (
      '🎨 <b>Оформление бота</b>\n\n' +
      `Смайлики в кнопках: <b>${useEmojis ? 'включены' : 'выключены'}</b>\n` +
      `Навигация в мастере: <b>${navStyle === 'arrows' ? 'стрелки' : 'слова'}</b>\n` +
      `Пример ряда кнопок: <code>${navExample}</code>\n\n` +
      '<b>Смайлики</b> — иконки в пунктах меню (главное меню, черновики, история и т.д.).\n' +
      '<b>Навигация</b> — только нижний ряд кнопок в мастере «Написать с ИИ».'
    );
  }

  static async formatGeneralScreen() {
    const tz = await SettingsService.getTimezone();
    const chatCleanup = await SettingsService.getChatCleanup();
    return (
      `🌍 <b>Основные настройки</b>\n\n` +
      `Очистка чата: <b>${chatCleanup ? 'включена' : 'выключена'}</b>\n` +
      `Старые сообщения бота удаляются при переходе между экранами.\n\n` +
      `Часовой пояс для истории и расписания:\n<b>${tz}</b>`
    );
  }

  static formatAiConnectError(err) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);

    if (status === 429 || /429|rate limit|too many requests/i.test(msg)) {
      return (
        '⏳ <b>Сервис временно перегружен</b> (лимит запросов).\n\n' +
        'Подождите 1–2 минуты и попробуйте снова. У бесплатных моделей OpenRouter лимиты строже.\n\n' +
        'Настройки → ИИ для постов → Подключить сервис.'
      );
    }

    if (status === 404 || /404|no endpoints found/i.test(msg)) {
      return (
        '❌ <b>Модель недоступна</b> на этом сервисе.\n\n' +
        'Попробуйте другую модель в настройках или выберите другой сервис.'
      );
    }

    if (status === 401 || status === 403 || /invalid.*key|unauthorized|authentication/i.test(msg)) {
      return '❌ <b>Неверный ключ API.</b> Проверьте ключ и отправьте снова.';
    }

    if (/timeout|ETIMEDOUT|ECONNRESET|timed out/i.test(msg)) {
      return '⏳ <b>Нет ответа от сервиса.</b> Проверьте интернет и попробуйте через минуту.';
    }

    return `❌ <b>Не удалось подключить:</b> ${SettingsUIService._escapeHtml(msg)}\n\nПопробуйте снова: Настройки → ИИ для постов.`;
  }

  static _escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  static formatHelpScreen() {
    return (
      '📖 <b>Инструкция</b>\n\n' +
      '<b>Главное меню</b>\n' +
      '• <b>Публикация</b> — готовый пост (текст, фото, видео) или мастер «Написать с ИИ». Дальше: опубликовать сейчас, запланировать или черновик.\n' +
      '• <b>Черновики</b> — сохранённые посты: изменить, опубликовать, удалить.\n' +
      '• <b>История</b> — архив канала и очередь публикаций (см. ниже).\n' +
      '• <b>Настройки</b> — нейросеть, часовой пояс, очистка чата, эта инструкция.\n\n' +
      '<b>История постов</b>\n' +
      'Фильтры: <b>Вышедшие</b>, <b>В очереди</b>, <b>Удалённые</b>, <b>Все посты</b>.\n' +
      'Если пост удалили в канале вручную — нажмите <b>🔄 Сверить с каналом</b> (нужна сессия GramJS) или выполните <code>npm run reconcile</code> на сервере.\n' +
      'Нажмите на пост — карточка с текстом, ссылкой в канал, полями ИИ (заголовок, суть, теги, категория), цепочкой ответов.\n' +
      'Метки: ✏️ изменён в канале, 🗑 удалён из канала, ↩ ответ на другой пост.\n' +
      'Для запланированных: опубликовать сейчас, перенести дату, отменить.\n\n' +
      '<b>Архив канала</b>\n' +
      'Бот должен быть админом канала. Новые посты и правки в канале подтягиваются автоматически.\n' +
      'Импорт старых постов и серверные команды — в <b>README</b> проекта на машине, где запущен бот.\n\n' +
      '<b>Команды в чате с ботом</b>\n' +
      '/start — главное меню\n' +
      '/settings — настройки\n' +
      '/stats — статистика архива\n' +
      '/pinchannel — закрепить ссылку на канал\n\n' +
      '<b>ИИ для постов</b>\n' +
      'Настройки → ИИ для постов → Подключить сервис. При автоанализе новые посты получают заголовок, суть, теги и категорию.\n\n' +
      '<b>Мастер «Написать с ИИ»</b> (Публикация → Написать с ИИ)\n' +
      '7 шагов: тема, описание, тон, язык/иностр. слова, особенность поста, медиа, ключевые слова. ' +
      'Навигация — один ряд: ← назад · по центру · вперёд → (стиль в «Настройки → Оформление»). ' +
      'На заполненных шагах показывается значение и «Изменить». ' +
      'При выходе («❌ Выйти» или «▶️ Меню») можно сохранить прогресс в черновики. Мастер-черновики — в разделе «Черновики». ' +
      'Если всё пропустить — создание отменяется. ИИ генерирует текст с HTML-форматированием; на предпросмотре — принять, перегенерировать (до 3 раз), править вручную или заменить медиа.\n\n' +
      '<b>Очистка чата</b>\n' +
      'В «Основные» можно включить удаление старых сообщений бота при переходе между экранами. Ключи API удаляются всегда.\n\n' +
      '<b>OpenRouter</b>\n' +
      'После ключа — «Проверяю подключение…». При ⏳ лимите запросов подождите 1–2 минуты и повторите.'
    );
  }

  static async getConfiguredProviderIds() {
    const ids = [];
    for (const p of AiProviderRegistry.listAll()) {
      const secrets = await SecretsService.getProviderSecret(p.id);
      if (AiProviderRegistry.isConfigured(p.id, secrets)) ids.push(p.id);
    }
    return ids;
  }
}

module.exports = SettingsUIService;
