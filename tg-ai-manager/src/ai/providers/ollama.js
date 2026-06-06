const { summarizeWithOpenAICompatible, validateOpenAICompatible } = require('../openaiCompatible');

const DEFAULT_BASE = 'http://127.0.0.1:11434/v1';

module.exports = {
  id: 'ollama',
  label: 'Ollama',
  tierLabel: 'локально, бесплатно',
  tier: 'free',
  secretFields: [
    {
      key: 'baseUrl',
      label: 'адрес сервера',
      placeholder: 'http://127.0.0.1:11434'
    }
  ],
  defaultModel: 'llama3.2',
  modelPresets: ['llama3.2', 'mistral', 'gemma2', 'qwen2.5'],

  isConfigured(secrets) {
    return Boolean(secrets?.baseUrl?.trim());
  },

  _baseUrl(secrets) {
    let url = (secrets.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    if (!url.endsWith('/v1')) url = `${url}/v1`;
    return url;
  },

  async validateConfig(secrets, model) {
    return validateOpenAICompatible({
      baseURL: this._baseUrl(secrets),
      apiKey: 'ollama',
      model: model || this.defaultModel
    });
  },

  async summarize(text, { model, secrets }) {
    return summarizeWithOpenAICompatible({
      baseURL: this._baseUrl(secrets),
      apiKey: 'ollama',
      model: model || this.defaultModel,
      text
    });
  },

  async generate(userPrompt, { model, secrets, systemPrompt }) {
    const { generateWithOpenAICompatible } = require('../openaiCompatible');
    return generateWithOpenAICompatible({
      baseURL: this._baseUrl(secrets),
      apiKey: 'ollama',
      model: model || this.defaultModel,
      userPrompt,
      systemPrompt
    });
  }
};
