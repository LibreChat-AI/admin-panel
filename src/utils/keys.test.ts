import { describe, it, expect } from 'vitest';
import {
  findBlankText,
  findUnsafeKeys,
  isUnsafeConfigKey,
  isWhitespaceSignificantPath,
} from './keys';

describe('isUnsafeConfigKey', () => {
  it('flags keys with a dot or a leading $', () => {
    expect(isUnsafeConfigKey('us.anthropic.claude-sonnet-4-6')).toBe(true);
    expect(isUnsafeConfigKey('$where')).toBe(true);
    expect(isUnsafeConfigKey('X-Thread-ID')).toBe(false);
    expect(isUnsafeConfigKey('price$')).toBe(false);
  });

  it('with dotted keys allowed, flags only $-prefixed keys and the prototype names', () => {
    expect(isUnsafeConfigKey('us.anthropic.claude-sonnet-4-6', true)).toBe(false);
    expect(isUnsafeConfigKey('gpt-4.1', true)).toBe(false);
    expect(isUnsafeConfigKey('$where', true)).toBe(true);
    expect(isUnsafeConfigKey('__proto__', true)).toBe(true);
    expect(isUnsafeConfigKey('constructor', true)).toBe(true);
    expect(isUnsafeConfigKey('prototype', true)).toBe(true);
    expect(isUnsafeConfigKey('constructorName', true)).toBe(false);
  });
});

describe('findUnsafeKeys', () => {
  it('finds dotted keys at any depth with the path of the holding object', () => {
    expect(
      findUnsafeKeys(
        {
          inferenceProfiles: { 'us.anthropic.x': 'arn', plain: 'arn' },
          nested: { deeper: { $set: 1 } },
        },
        'endpoints.bedrock',
      ),
    ).toEqual([
      { path: 'endpoints.bedrock.inferenceProfiles', key: 'us.anthropic.x' },
      { path: 'endpoints.bedrock.nested.deeper', key: '$set' },
    ]);
  });

  it('checks keys inside arrays of objects and key/value pair lists', () => {
    expect(
      findUnsafeKeys([{ name: 'a', headers: { 'x.thread.id': '1' } }], 'endpoints.custom'),
    ).toEqual([{ path: 'endpoints.custom.0.headers', key: 'x.thread.id' }]);
    expect(
      findUnsafeKeys(
        [
          { key: 'x.thread.id', value: '1', valueType: 'string' },
          { key: 'ok', value: '2', valueType: 'string' },
        ],
        'endpoints.custom.11.headers',
      ),
    ).toEqual([{ path: 'endpoints.custom.11.headers', key: 'x.thread.id' }]);
  });

  it('with dotted keys allowed, finds only the keys the server refuses', () => {
    expect(
      findUnsafeKeys(
        {
          inferenceProfiles: { 'us.anthropic.x': 'arn' },
          headers: [{ key: '$x', value: '1', valueType: 'string' }],
          nested: { deeper: { $set: 1, 'a.b': 2 } },
        },
        'endpoints.bedrock',
        true,
      ),
    ).toEqual([
      { path: 'endpoints.bedrock.headers', key: '$x' },
      { path: 'endpoints.bedrock.nested.deeper', key: '$set' },
    ]);
  });

  it('ignores dots in values and returns nothing for safe input', () => {
    expect(findUnsafeKeys({ url: 'https://a.b.c', models: ['gpt-4.1'] }, 'x')).toEqual([]);
    expect(findUnsafeKeys('a.b', 'x')).toEqual([]);
  });
});

describe('findBlankText', () => {
  it('finds whitespace-only strings and keys, and empty values under an object', () => {
    expect(
      findBlankText(
        { a: '   ', b: '', c: ' x ', headers: { '  ': 'v', ok: '\t' }, list: ['ok', ' '] },
        'root',
      ),
    ).toEqual([
      { path: 'root.a' },
      { path: 'root.b' },
      { path: 'root.headers', key: '  ' },
      { path: 'root.headers.ok' },
      { path: 'root.list.1' },
    ]);
  });

  it('flags a header with a key but no value, not an empty value on its own', () => {
    expect(findBlankText({ 'X-A': 'a', 'X-C': '' }, 'mcpServers.s.headers')).toEqual([
      { path: 'mcpServers.s.headers.X-C' },
    ]);
    expect(findBlankText([{ key: 'X-C', value: '' }], 'h')).toEqual([{ path: 'h.X-C' }]);
    expect(findBlankText('', 'endpoints.custom.0.iconURL')).toEqual([]);
  });

  it('finds blank keys and values in key/value pairs', () => {
    expect(
      findBlankText(
        [
          { key: ' ', value: 'v' },
          { key: 'X', value: '  ' },
        ],
        'h',
      ),
    ).toEqual([{ path: 'h', key: ' ' }, { path: 'h.X' }]);
  });

  it('lets stop sequences keep their whitespace', () => {
    expect(findBlankText({ addParams: { stop: ['\n', '\n\n'] } }, 'endpoints.custom.0')).toEqual(
      [],
    );
    expect(findBlankText({ stop: '\n' }, 'x.addParams')).toEqual([]);
    expect(isWhitespaceSignificantPath('modelSpecs.list.2.preset.stop.0')).toBe(true);
    expect(isWhitespaceSignificantPath('modelSpecs.list.2.preset.stop')).toBe(true);
    expect(isWhitespaceSignificantPath('endpoints.openAI.titleModel')).toBe(false);
  });
});
