module.exports = {
  id: 'groq',
  label: 'Groq',
  tierLabel: 'бесплатный',
  tier: 'free',
  secretFields: [{ key: 'apiKey', label: 'ключ API', placeholder: 'gsk_...' }],
  defaultModel: 'llama-3.3-70b-versatile',
  modelPresets: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],

  isConfigured(secrets) {
    return Boolean(secrets?.apiKey?.trim());
  },

  async validateConfig(secrets, model) {
    const { validateOpenAICompatible } = require('../openaiCompatible');
    return validateOpenAICompatible({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel
    });
  },

  async summarize(text, { model, secrets }) {
    const { summarizeWithOpenAICompatible } = require('../openaiCompatible');
    return summarizeWithOpenAICompatible({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      text
    });
  },

  async generate(userPrompt, { model, secrets, systemPrompt }) {
    const { generateWithOpenAICompatible } = require('../openaiCompatible');
    return generateWithOpenAICompatible({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: secrets.apiKey,
      model: model || this.defaultModel,
      userPrompt,
      systemPrompt
    });
  }
};
