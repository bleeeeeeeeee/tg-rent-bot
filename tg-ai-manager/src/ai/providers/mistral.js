module.exports = {
  id: 'mistral',
  label: 'Mistral AI',
  tierLabel: 'бесплатный лимит',
  tier: 'free',
  secretFields: [{ key: 'apiKey', label: 'ключ API', placeholder: '...' }],
  defaultModel: 'mistral-small-latest',
  modelPresets: ['mistral-small-latest', 'open-mistral-7b', 'mistral-large-latest'],

  isConfigured(secrets) {
    return Boolean(secrets?.apiKey?.trim());
  },

  async validateConfig(secrets, model) {
    const { validateOpenAICompatible } = require('../openaiCompatible');
    return validateOpenAICompatible({
      baseURL: 'https://api.mistral.ai/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel
    });
  },

  async summarize(text, { model, secrets }) {
    const { summarizeWithOpenAICompatible } = require('../openaiCompatible');
    return summarizeWithOpenAICompatible({
      baseURL: 'https://api.mistral.ai/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      text
    });
  },

  async generate(userPrompt, { model, secrets, systemPrompt }) {
    const { generateWithOpenAICompatible } = require('../openaiCompatible');
    return generateWithOpenAICompatible({
      baseURL: 'https://api.mistral.ai/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      userPrompt,
      systemPrompt
    });
  }
};
