import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  isKeyedPath,
  getKeyedValue,
  parseKeyedPath,
  formatKeyedPath,
  hiddenEntriesOf,
  isPathAtOrUnder,
  isKeyedAtOrUnder,
  removeKeyedValue,
  hiddenRecordKeysOf,
  getConfigPathValue,
  removeConfigPathValue,
  isAddressableEntryKey,
  isAddressableEntryPath,
} from './keyed';
import { KEYED_COLLECTIONS } from '@/constants';

const custom = KEYED_COLLECTIONS.get('endpoints.custom') as t.KeyedCollection;

const config: t.ConfigRecord = {
  endpoints: {
    custom: [
      { name: 'Ollama', baseURL: 'http://ollama', headers: { 'X-Team': 'a', 'X-Org': 'b' } },
      { name: 'api.example.com "v2"', baseURL: 'https://v2' },
      { name: 'Bare', headers: { 'X-Only': 'c' } },
    ],
  },
};

describe('keyed paths', () => {
  it.each(['Gateway', 'api.example.com "v2"', 'a]b["c', 'ünïcode', 'dots.and spaces'])(
    'formats and reads back the name %s',
    (name) => {
      const path = formatKeyedPath('endpoints.custom', name, 'headers.X-Team');
      expect(isKeyedPath(path)).toBe(true);
      expect(parseKeyedPath(path)).toEqual({
        collection: custom,
        key: name,
        rest: 'headers.X-Team',
      });
      expect(parseKeyedPath(formatKeyedPath('endpoints.custom', name))).toEqual({
        collection: custom,
        key: name,
        rest: '',
      });
    },
  );

  it('reads only entries of a collection LibreChat merges by key', () => {
    expect(parseKeyedPath('modelSpecs.list["Spec"]')).toBeNull();
    expect(parseKeyedPath('mcpServers.a["b"]')).toBeNull();
    expect(parseKeyedPath('endpoints.custom.0.headers')).toBeNull();
    expect(parseKeyedPath('endpoints.custom["unclosed')).toBeNull();
    expect(parseKeyedPath('endpoints.custom["Name"]x')).toBeNull();
  });

  it('names an entry as LibreChat matches it, and removes it or a value inside it', () => {
    const ollama = parseKeyedPath('endpoints.custom["ollama"]') as t.KeyedPath;
    expect(getKeyedValue(config, ollama)).toMatchObject({ name: 'Ollama' });
    expect(getConfigPathValue(config, 'endpoints.custom["Ollama"].headers.X-Team')).toBe('a');
    const withoutHeader = removeConfigPathValue(
      config,
      'endpoints.custom["Ollama"].headers.X-Team',
    );
    expect(getConfigPathValue(withoutHeader, 'endpoints.custom["Ollama"].headers')).toEqual({
      'X-Org': 'b',
    });
    const withoutEntry = removeKeyedValue(config, ollama);
    expect(getKeyedValue(withoutEntry, ollama)).toBeUndefined();
    expect(getConfigPathValue(withoutEntry, 'endpoints.custom')).toHaveLength(2);
  });

  it('drops an own entry left holding only its key, as LibreChat stores it', () => {
    const path = 'endpoints.custom["Bare"].headers';
    expect(
      getConfigPathValue(removeConfigPathValue(config, path), 'endpoints.custom'),
    ).toHaveLength(3);
    expect(
      getConfigPathValue(removeConfigPathValue(config, path, true), 'endpoints.custom'),
    ).toHaveLength(2);
  });

  it('leaves dotted paths to the dotted helpers', () => {
    expect(getConfigPathValue(config, 'endpoints.custom.1.baseURL')).toBe('https://v2');
  });

  it('counts an entry key step as below its collection', () => {
    expect(isPathAtOrUnder('endpoints.custom["A"]', 'endpoints.custom')).toBe(true);
    expect(isPathAtOrUnder('endpoints.custom["A"].headers.X', 'endpoints.custom["A"]')).toBe(true);
    expect(isPathAtOrUnder('endpoints.customs', 'endpoints.custom')).toBe(false);
    expect(isPathAtOrUnder('endpoints.custom', 'endpoints.custom["A"]')).toBe(false);
  });

  it('reads a keyed path at or inside another by the entry LibreChat matches', () => {
    const entry = parseKeyedPath('endpoints.custom["Ollama"]') as t.KeyedPath;
    const headers = parseKeyedPath('endpoints.custom["Ollama"].headers') as t.KeyedPath;
    expect(isKeyedAtOrUnder('endpoints.custom["ollama"].headers.X', entry)).toBe(true);
    expect(isKeyedAtOrUnder('endpoints.custom["OLLAMA"]', entry)).toBe(true);
    expect(isKeyedAtOrUnder('endpoints.custom["Ollama"].headers.X', headers)).toBe(true);
    expect(isKeyedAtOrUnder('endpoints.custom["Ollama"].addParams.X', headers)).toBe(false);
    expect(isKeyedAtOrUnder('endpoints.custom["Other"].headers.X', entry)).toBe(false);
    expect(isKeyedAtOrUnder('endpoints.custom.headers', entry)).toBe(false);
  });

  it('lists the entries and record keys tombstones remove, by identity', () => {
    const tombstones = [
      'endpoints.custom["OLLAMA"]',
      'endpoints.custom["Gateway"].headers.X-Team',
      'endpoints.custom["Gateway"].headers.a.b',
      'mcpServers.docs',
    ];
    expect([...hiddenEntriesOf(tombstones, custom)]).toEqual([
      ['ollama', 'endpoints.custom["OLLAMA"]'],
    ]);
    expect([...hiddenRecordKeysOf(tombstones, custom, 'Gateway', 'headers')]).toEqual(['X-Team']);
  });

  it('refuses names and keys LibreChat cannot name by key', () => {
    expect(isAddressableEntryKey('Gateway')).toBe(true);
    expect(isAddressableEntryKey('$ref')).toBe(false);
    expect(isAddressableEntryKey('__proto__')).toBe(false);
    expect(isAddressableEntryKey('constructor')).toBe(false);
    expect(isAddressableEntryKey('x'.repeat(257))).toBe(false);
    expect(isAddressableEntryKey('x'.repeat(20), 10)).toBe(false);
    expect(isAddressableEntryPath(['headers', 'X-Team'])).toBe(true);
    expect(isAddressableEntryPath(['headers', 'x.y'])).toBe(false);
    expect(isAddressableEntryPath(['headers', '$x'])).toBe(false);
  });
});
