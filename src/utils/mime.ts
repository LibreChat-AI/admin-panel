import {
  textMimeTypes,
  audioMimeTypes,
  excelMimeTypes,
  imageMimeTypes,
  videoMimeTypes,
  supportedMimeTypes,
  defaultOCRMimeTypes,
  applicationMimeTypes,
  defaultTextMimeTypes,
  isDocumentSupportedProvider,
} from 'librechat-data-provider';
import type * as t from '@/types';

/** Probe LibreChat itself uses to tell a permissive MIME list (`isPermissiveMimeConfig`). */
const PERMISSIVE_PROBE = 'x-librechat/x-probe';

/** Lookarounds and backreferences: the server's linear-time regex engine (RE2) rejects them. */
const UNSUPPORTED_SYNTAX = /\(\?<?[=!]|\\[1-9]|\\k</;

const PDF_PATTERN = '^application\\/pdf$';
const OFFICE_PATTERN =
  '^application\\/(msword|vnd\\.ms-(excel|powerpoint)|vnd\\.openxmlformats-officedocument\\.(wordprocessingml\\.document|spreadsheetml\\.sheet|presentationml\\.(presentation|template)))$';
const CODE_DATA_PATTERN = '^application\\/(json|xml|yaml|x-yaml|x-sh|typescript|sql|csv)$';

/** Endpoint keys LibreChat ships its own upload settings for; the Default entry never applies to them. */
const BUILT_IN_ENDPOINT_KEYS: ReadonlySet<string> = new Set([
  'default',
  'agents',
  'assistants',
  'azureAssistants',
  'anthropic',
]);

const sources = (patterns: RegExp[]): string[] => patterns.map((pattern) => pattern.source);

/** LibreChat's built-in lists, as the pattern strings librechat.yaml takes. */
export const DEFAULT_MIME_LISTS: Readonly<Record<t.MimeListKind, readonly string[]>> = {
  endpoint: sources(supportedMimeTypes),
  text: sources(defaultTextMimeTypes),
  ocr: sources(defaultOCRMimeTypes),
};

/** One-click additions to a MIME list (FX-7). */
export const MIME_PRESETS: readonly t.MimePreset[] = [
  { key: 'images', labelKey: 'com_config_mime_preset_images', patterns: [imageMimeTypes.source] },
  { key: 'pdf', labelKey: 'com_config_mime_preset_pdf', patterns: [PDF_PATTERN] },
  {
    key: 'office',
    labelKey: 'com_config_mime_preset_office',
    patterns: [OFFICE_PATTERN, excelMimeTypes.source],
  },
  {
    key: 'text',
    labelKey: 'com_config_mime_preset_text',
    patterns: [textMimeTypes.source, CODE_DATA_PATTERN],
  },
  { key: 'audio', labelKey: 'com_config_mime_preset_audio', patterns: [audioMimeTypes.source] },
];

/** Friendly names for the patterns LibreChat's defaults and the presets use. */
const KNOWN_PATTERN_LABELS: ReadonlyMap<string, string> = new Map([
  [textMimeTypes.source, 'com_config_mime_known_text'],
  [excelMimeTypes.source, 'com_config_mime_known_excel'],
  [applicationMimeTypes.source, 'com_config_mime_known_documents'],
  [imageMimeTypes.source, 'com_config_mime_known_images'],
  [videoMimeTypes.source, 'com_config_mime_known_video'],
  [audioMimeTypes.source, 'com_config_mime_known_audio'],
  ['^image\\/(svg|svg\\+xml)$', 'com_config_mime_known_svg'],
  ['^message\\/rfc822$', 'com_config_mime_known_email'],
  [PDF_PATTERN, 'com_config_mime_known_pdf'],
  [OFFICE_PATTERN, 'com_config_mime_known_office'],
  [CODE_DATA_PATTERN, 'com_config_mime_known_code_data'],
  [
    '^application\\/vnd\\.openxmlformats-officedocument\\.(wordprocessingml\\.document|presentationml\\.presentation)$',
    'com_config_mime_known_docx_pptx',
  ],
  [
    '^application\\/vnd\\.openxmlformats-officedocument\\.presentationml\\.template$',
    'com_config_mime_known_potx',
  ],
  ['^application\\/vnd\\.ms-(word|powerpoint)$', 'com_config_mime_known_legacy_office'],
  ['^application\\/epub\\+zip$', 'com_config_mime_known_epub'],
  [
    '^application\\/vnd\\.oasis\\.opendocument\\.(text|spreadsheet|presentation|graphics)$',
    'com_config_mime_known_opendocument',
  ],
  ['^[\\w.-]+\\/[\\w.-]+$', 'com_config_mime_known_any'],
]);

/** The MIME list a data path holds, or undefined for any other path. */
export function mimeListKind(path: string): t.MimeListKind | undefined {
  if (path === 'fileConfig.text.supportedMimeTypes') return 'text';
  if (path === 'fileConfig.ocr.supportedMimeTypes') return 'ocr';
  if (/^fileConfig\.endpoints\.[^.]+\.supportedMimeTypes$/.test(path)) return 'endpoint';
  return undefined;
}

/** The `fileConfig.endpoints` key of an endpoint MIME list path. */
export function mimeEndpointKey(path: string): string | undefined {
  return /^fileConfig\.endpoints\.([^.]+)\.supportedMimeTypes$/.exec(path)?.[1];
}

/**
 * Whether an endpoint key's unset list falls back to the `default` entry's
 * list: LibreChat gives its built-in endpoints (agents, assistants, Anthropic)
 * and document-capable providers its full built-in list instead.
 */
export function usesDefaultEntryList(endpointKey: string): boolean {
  return !BUILT_IN_ENDPOINT_KEYS.has(endpointKey) && !isDocumentSupportedProvider(endpointKey);
}

/** Locale key of a known pattern's friendly name. */
export function knownMimePatternLabel(pattern: string): string | undefined {
  return KNOWN_PATTERN_LABELS.get(pattern);
}

/** Compiles a pattern the way the browser would, or null when it is not a valid regular expression. */
function compileMimePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Why a pattern can't be saved: invalid, unsupported on the server, or a duplicate of another entry. */
export function mimePatternIssue(
  pattern: string,
  others: readonly string[] = [],
): t.MimePatternIssue | undefined {
  if (compileMimePattern(pattern) == null) return 'invalid';
  if (UNSUPPORTED_SYNTAX.test(pattern)) return 'unsupported';
  if (others.includes(pattern)) return 'duplicate';
  return undefined;
}

/** Whether a pattern accepts every file type (`''`, `.*`, `.+` and the like). */
export function isMatchAllMimePattern(pattern: string): boolean {
  const regex = compileMimePattern(pattern);
  return regex != null && regex.test(PERMISSIVE_PROBE);
}

/** The first pattern of `patterns` that matches `mimeType`, if any. */
export function matchMimeType(mimeType: string, patterns: readonly string[]): string | undefined {
  const type = mimeType.trim().toLowerCase();
  if (!type) return undefined;
  return patterns.find((pattern) => compileMimePattern(pattern)?.test(type) === true);
}

/** `patterns` plus each of `additions` not already in it, in order. */
export function addMimePatterns(
  patterns: readonly string[],
  additions: readonly string[],
): string[] {
  const seen = new Set(patterns);
  const next = [...patterns];
  for (const pattern of additions) {
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    next.push(pattern);
  }
  return next;
}
