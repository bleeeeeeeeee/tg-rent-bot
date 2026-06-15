const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseTopicResponse, buildTopicUserPrompt, sanitizeTopicLanguage } = require('../src/ai/topicPrompt');

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

  it('buildTopicUserPrompt includes direction when set', () => {
    const prompt = buildTopicUserPrompt({
      mode: 'similar',
      count: 3,
      channelContext: { channelHint: 'Test' },
      usedTopics: [],
      referencePosts: [],
      direction: 'обзоры гаджетов'
    });
    assert.match(prompt, /обзоры гаджетов/);
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

  it('buildTopicUserPrompt includes language rules', () => {
    const prompt = buildTopicUserPrompt({
      mode: 'unique',
      count: 5,
      channelContext: {},
      usedTopics: [],
      referencePosts: []
    });
    assert.match(prompt, /имен/i);
    assert.match(prompt, /buildingов/i);
  });

  it('sanitizeTopicLanguage fixes anglicisms and hybrids', () => {
    assert.equal(
      sanitizeTopicLanguage('Изучение buildings и buildingов в кино'),
      'Изучение здания и здание в кино'
    );
    assert.equal(
      sanitizeTopicLanguage('роль street-art в городе'),
      'роль street-art в городе'
    );
    assert.equal(sanitizeTopicLanguage('many own design'), 'много собственный дизайн');
  });

  it('parseTopicResponse sanitizes topic fields', () => {
    const raw = JSON.stringify({
      topics: [{ title: 'Тема', brief: 'Про buildings и buildingов', angle: 'style matters', tags: ['design'] }]
    });
    const topics = parseTopicResponse(raw);
    assert.match(topics[0].brief, /здани/);
    assert.doesNotMatch(topics[0].brief, /building/i);
    assert.equal(topics[0].tags[0], 'дизайн');
  });
});

describe('SettingsUIService formatAiConnectError', () => {
  it('detects connection errors', async () => {
    const SettingsUIService = require('../src/services/SettingsUIService');
    const msg = await SettingsUIService.formatAiConnectError(new Error('Connection error.'), 'ru');
    assert.match(msg, /Не удалось подключиться/);
  });
});
