const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseTopicResponse, buildTopicUserPrompt } = require('../src/ai/topicPrompt');

describe('topicPrompt', () => {
  it('parseTopicResponse extracts topics from JSON', () => {
    const raw = JSON.stringify({
      topics: [
        { title: 'Тема 1', brief: 'Описание 1', angle: 'Угол', tags: ['a', 'b'] },
        { title: '', brief: 'skip' },
        { topic: 'Тема 2', description: 'Описание 2' }
      ]
    });
    const topics = parseTopicResponse(raw);
    assert.equal(topics.length, 2);
    assert.equal(topics[0].title, 'Тема 1');
    assert.deepEqual(topics[0].tags, ['a', 'b']);
    assert.equal(topics[1].title, 'Тема 2');
  });

  it('buildTopicUserPrompt includes mode and used topics', () => {
    const prompt = buildTopicUserPrompt({
      mode: 'unique',
      count: 5,
      channelContext: { channelHint: 'Test channel', recentSummaries: ['Post A'] },
      usedTopics: ['Old topic'],
      referencePosts: []
    });
    assert.match(prompt, /уникальные/);
    assert.match(prompt, /Old topic/);
    assert.match(prompt, /Post A/);
  });
});

describe('SettingsUIService formatAiConnectError', () => {
  it('detects connection errors', async () => {
    const SettingsUIService = require('../src/services/SettingsUIService');
    const msg = await SettingsUIService.formatAiConnectError(new Error('Connection error.'), 'ru');
    assert.match(msg, /Не удалось подключиться/);
  });
});
