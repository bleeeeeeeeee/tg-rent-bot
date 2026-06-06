module.exports = {
  id: 'deepseek',
  label: 'DeepSeek',
  tierLabel: 'бесплатный лимит',
  tier: 'free',
  secretFields: [{ key: 'apiKey', label: 'ключ API', placeholder: 'sk-...' }],
  defaultModel: 'deepseek-chat',
  modelPresets: ['deepseek-chat', 'deepseek-reasoner'],

  isConfigured(secrets) {
    return Boolean(secrets?.apiKey?.trim());
  },

  async validateConfig(secrets, model) {
    const { validateOpenAICompatible } = require('../openaiCompatible');
    return validateOpenAICompatible({
      baseURL: 'https://api.deepseek.com',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel
    });
  },

  async summarize(text, { model, secrets }) {
    const { summarizeWithOpenAICompatible } = require('../openaiCompatible');
    return summarizeWithOpenAICompatible({
      baseURL: 'https://api.deepseek.com',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      text
    });
  },

  async generate(userPrompt, { model, secrets, systemPrompt }) {
    const { generateWithOpenAICompatible } = require('../openaiCompatible');
    return generateWithOpenAICompatible({
      baseURL: 'https://api.deepseek.com',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      userPrompt,
      systemPrompt
    });
  }
};
