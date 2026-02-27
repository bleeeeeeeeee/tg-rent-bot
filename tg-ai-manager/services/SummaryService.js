// simple wrapper around an LLM for generating post summaries
class SummaryService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || null;
    }

    async summarize(text) {
        if (!text || text.trim() === '') return null;
        // if no API key available just return fallback summary (first words)
        if (!this.apiKey) {
            const sample = text.trim().split('\n')[0];
            return { main: sample, description: sample };
        }

        const prompt = `You are an assistant that summarizes Telegram posts.\n` +
            `Given the following message text:\n\n${text}\n\n` +
            `Provide a JSON object with fields:\n` +
            `{
  "title": "<short title/theme>",
  "main": "<one-sentence main idea>",
  "description": "<brief description, 1–2 sentences>",
  "keywords": ["<optional list of searchable tags or words>"]
}
`;

        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 300
                })
            });
            const data = await res.json();
            const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (!content) return null;
            // try parse JSON from response
            let json = null;
            try { json = JSON.parse(content); } catch (e) {
                // sometimes model returns text around JSON – attempt to extract
                const match = content.match(/\{[\s\S]*\}/);
                if (match) {
                    json = JSON.parse(match[0]);
                }
            }
            if (json) return json;
            // if parsing failed, fall back to simple snippet
            const sample = text.trim().split('\n')[0];
            return { main: sample, description: sample };
        } catch (e) {
            console.error('SummaryService error', e);
            return null;
        }
    }
}

module.exports = new SummaryService();