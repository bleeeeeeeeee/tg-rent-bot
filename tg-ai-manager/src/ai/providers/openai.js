module.exports = {
  id: 'openai',
  label: 'OpenAI',
  tierLabel: 'платный',
  tier: 'paid',
  secretFields: [{ key: 'apiKey', label: 'ключ API', placeholder: 'sk-...' }],
  defaultModel: 'gpt-4o-mini',
  modelPresets: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],

  isConfigured(secrets) {
    return Boolean(secrets?.apiKey?.trim());
  },

  async validateConfig(secrets, model) {
    const { validateOpenAICompatible } = require('../openaiCompatible');
    return validateOpenAICompatible({
      baseURL: 'https://api.openai.com/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel
    });
  },

  async summarize(text, { model, secrets }) {
    const { summarizeWithOpenAICompatible } = require('../openaiCompatible');
    return summarizeWithOpenAICompatible({
      baseURL: 'https://api.openai.com/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      text
    });
  },

  async generate(userPrompt, { model, secrets, systemPrompt }) {
    const { generateWithOpenAICompatible } = require('../openaiCompatible');
    return generateWithOpenAICompatible({
      baseURL: 'https://api.openai.com/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      userPrompt,
      systemPrompt
    });
  }
};
