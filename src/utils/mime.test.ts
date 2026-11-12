import { describe, it, expect } from 'vitest';
import { mergeFileConfig, getEndpointFileConfig } from 'librechat-data-provider';
import type { RegexLike } from 'librechat-data-provider';
import {
  MIME_PRESETS,
  mimeListKind,
  matchMimeType,
  addMimePatterns,
  mimeEndpointKey,
  mimePatternIssue,
  DEFAULT_MIME_LISTS,
  usesDefaultEntryList,
  isMatchAllMimePattern,
  knownMimePatternLabel,
} from './mime';

/** Pattern strings of compiled MIME matchers. */
function sourcesOf(list: RegexLike[] | undefined): string[] {
  return (list ?? []).map((regex) => (regex instanceof RegExp ? regex.source : ''));
}

describe('mimeListKind', () => {
  it('tells the text, OCR and endpoint lists apart', () => {
    expect(mimeListKind('fileConfig.text.supportedMimeTypes')).toBe('text');
    expect(mimeListKind('fileConfig.ocr.supportedMimeTypes')).toBe('ocr');
    expect(mimeListKind('fileConfig.endpoints.agents.supportedMimeTypes')).toBe('endpoint');
    expect(mimeListKind('fileConfig.endpoints.agents.fileLimit')).toBeUndefined();
    expect(mimeEndpointKey('fileConfig.endpoints.My Endpoint.supportedMimeTypes')).toBe(
      'My Endpoint',
    );
  });
});

describe('mimePatternIssue', () => {
  it('accepts plain types and regular expressions', () => {
    expect(mimePatternIssue('application/pdf')).toBeUndefined();
    expect(mimePatternIssue('^image\\/(png|jpeg)$')).toBeUndefined();
  });

  it('rejects invalid expressions, server-unsupported syntax and duplicates', () => {
    expect(mimePatternIssue('text/(plain')).toBe('invalid');
    expect(mimePatternIssue('^(?!image).*$')).toBe('unsupported');
    expect(mimePatternIssue('(a)\\1')).toBe('unsupported');
    expect(mimePatternIssue('image/.*', ['image/.*'])).toBe('duplicate');
  });
});

describe('isMatchAllMimePattern', () => {
  it('flags patterns that accept every file type, as LibreChat probes them', () => {
    for (const pattern of ['', '.*', '.+', '^.*$', '/']) {
      expect(isMatchAllMimePattern(pattern)).toBe(true);
    }
    expect(isMatchAllMimePattern('image/.*')).toBe(false);
    expect(isMatchAllMimePattern('text/(plain')).toBe(false);
  });
});

describe('matchMimeType', () => {
  it('returns the first pattern that matches, ignoring case and spaces', () => {
    const patterns = ['^image\\/png$', 'application/pdf'];
    expect(matchMimeType(' Application/PDF ', patterns)).toBe('application/pdf');
    expect(matchMimeType('image/jpeg', patterns)).toBeUndefined();
    expect(matchMimeType('', patterns)).toBeUndefined();
  });

  it('agrees with LibreChat on its own default lists', () => {
    const merged = mergeFileConfig(undefined);
    for (const type of ['application/pdf', 'image/png', 'text/csv', 'application/x-msdownload']) {
      const accepted = (merged.endpoints.default.supportedMimeTypes ?? []).some((regex) =>
        regex.test(type),
      );
      expect(matchMimeType(type, DEFAULT_MIME_LISTS.endpoint) !== undefined).toBe(accepted);
    }
  });
});

describe('DEFAULT_MIME_LISTS', () => {
  it('round-trips through librechat.yaml as LibreChat merges it', () => {
    const merged = mergeFileConfig({
      ocr: { supportedMimeTypes: [...DEFAULT_MIME_LISTS.ocr] },
      text: { supportedMimeTypes: [...DEFAULT_MIME_LISTS.text] },
    });
    expect(sourcesOf(merged.ocr?.supportedMimeTypes)).toEqual(DEFAULT_MIME_LISTS.ocr);
    expect(sourcesOf(merged.text?.supportedMimeTypes)).toEqual(DEFAULT_MIME_LISTS.text);
  });

  it('labels every default pattern', () => {
    const all = [
      ...DEFAULT_MIME_LISTS.endpoint,
      ...DEFAULT_MIME_LISTS.ocr,
      ...DEFAULT_MIME_LISTS.text,
    ];
    expect(all.filter((pattern) => !knownMimePatternLabel(pattern))).toEqual([]);
  });
});

describe('usesDefaultEntryList', () => {
  it('matches which endpoints LibreChat gives the Default entry list', () => {
    const dynamic = {
      endpoints: {
        default: { supportedMimeTypes: ['^text\\/plain$'] },
        myCustom: { fileLimit: 3 },
        openAI: { fileLimit: 3 },
      },
    };
    const merged = mergeFileConfig(dynamic);
    const listOf = (endpoint: string, endpointType?: string) =>
      sourcesOf(
        getEndpointFileConfig({ fileConfig: merged, endpoint, endpointType }).supportedMimeTypes,
      );
    expect(usesDefaultEntryList('myCustom')).toBe(true);
    expect(listOf('myCustom', 'custom')).toEqual(['^text\\/plain$']);
    expect(usesDefaultEntryList('openAI')).toBe(false);
    expect(listOf('openAI', 'openAI')).toEqual(DEFAULT_MIME_LISTS.endpoint);
    expect(usesDefaultEntryList('agents')).toBe(false);
    expect(listOf('agents', 'agents')).toEqual(DEFAULT_MIME_LISTS.endpoint);
  });
});

describe('addMimePatterns', () => {
  it('appends only patterns not already listed', () => {
    const images = MIME_PRESETS.find((preset) => preset.key === 'images')!;
    const once = addMimePatterns(['application/pdf'], images.patterns);
    expect(once).toEqual(['application/pdf', ...images.patterns]);
    expect(addMimePatterns(once, images.patterns)).toEqual(once);
  });

  it('only offers presets the server accepts and none that match everything', () => {
    for (const pattern of MIME_PRESETS.flatMap((preset) => preset.patterns)) {
      expect(mimePatternIssue(pattern)).toBeUndefined();
      expect(isMatchAllMimePattern(pattern)).toBe(false);
    }
  });
});
