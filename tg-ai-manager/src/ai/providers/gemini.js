module.exports = {
  id: 'gemini',
  label: 'Google Gemini',
  tierLabel: 'бесплатный',
  tier: 'free',
  secretFields: [{ key: 'apiKey', label: 'ключ API', placeholder: 'AI...' }],
  defaultModel: 'gemini-2.0-flash',
  modelPresets: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],

  isConfigured(secrets) {
    return Boolean(secrets?.apiKey?.trim());
  },

  async validateConfig(secrets, model) {
    await this.summarize('Тест API.', { model: model || this.defaultModel, secrets });
    return true;
  },

  async summarize(text, { model, secrets }) {
    const { SYSTEM_PROMPT, parseSummaryResponse, truncateText } = require('../summarizePrompt');
    const modelName = model || this.defaultModel;
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(secrets.apiKey)}`;

    const body = {
      contents: [{ parts: [{ text: truncateText(text) }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return parseSummaryResponse(raw);
  },

  async generate(userPrompt, { model, secrets, systemPrompt }) {
    const { WRITE_SYSTEM_PROMPT, parseWriteResponse } = require('../writePrompt');
    const { truncateText } = require('../summarizePrompt');
    const modelName = model || this.defaultModel;
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(secrets.apiKey)}`;

    const body = {
      contents: [{ parts: [{ text: truncateText(userPrompt, 6000) }] }],
      systemInstruction: { parts: [{ text: systemPrompt || WRITE_SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return parseWriteResponse(raw);
  },

  async completeRaw(userPrompt, { model, secrets, systemPrompt }) {
    const { truncateText } = require('../summarizePrompt');
    const modelName = model || this.defaultModel;
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(secrets.apiKey)}`;

    const body = {
      contents: [{ parts: [{ text: truncateText(userPrompt, 8000) }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.85,
        responseMimeType: 'application/json'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
};
