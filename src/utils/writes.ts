import type * as t from '@/types';
import {
  SKIP_REASON_KEYS,
  BUNDLED_WRITE_RULES,
  REPORTED_SKIP_REASONS,
  CREDENTIAL_ENTRY_RECORDS,
  DEDICATED_CONFIG_SECTIONS,
  getConfigSection,
  getReadOnlyReason,
  isYamlManagedPath,
} from '@/constants';
import { isInterfacePermissionPath } from './interfacePermissions';
import translation from '@/locales/en/translation.json';
import { pathIndexOverlaps } from './paths';
import { entryLocation } from './collections';
import { getValueAtPath } from './format';

/** Skipped changes without repeats (the client, the server and each PATCH can report the same path). */
export function uniqueSkipped(skipped: t.SkippedChange[]): t.SkippedChange[] {
  const seen = new Set<string>();
  return skipped.filter(({ fieldPath, reason }) => {
    const key = `${fieldPath}|${reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** English text for a skip reason, for server-side errors (the UI localizes `SKIP_REASON_KEYS`). */
export function describeSkipReason(reason: t.SkipReason): string {
  const key = SKIP_REASON_KEYS[reason] as keyof typeof translation;
  return translation[key] ?? reason;
}

/**
 * Why a save (or reset) at `path` must not be sent to the generic admin config
 * API, or null when it can be. The one rule set for the review, the server
 * pre-flight and every write path (save, import, profile saves). Removing a
 * stale override of a YAML-managed field, or of a section LibreChat only reads
 * from librechat.yaml, is allowed (it only removes data); writing one is not.
 * `rules` are the server's (`getWriteRules`); the bundled ones by default.
 */
export function getWriteSkipReason(
  path: string,
  isReset: boolean,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): t.SkipReason | null {
  if (isInterfacePermissionPath(path)) return 'permission';
  const readOnly = getReadOnlyReason(path, rules);
  if (readOnly && !(isReset && readOnly === 'yamlOnly')) return readOnly;
  if (DEDICATED_CONFIG_SECTIONS.has(getConfigSection(path))) return 'dedicated';
  if (!isReset && isYamlManagedPath(path, rules)) return 'yamlOnly';
  return null;
}

/** YAML-managed fields carried inside a value saved at an ancestor path (e.g. `endpoints.azureOpenAI`). */
export function findYamlManagedValues(
  path: string,
  value: t.ConfigValue,
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
): string[] {
  const prefix = `${path}.`;
  return [...rules.yamlManagedFields].filter(
    (managed) =>
      managed.startsWith(prefix) && getValueAtPath(value, managed.slice(prefix.length)) != null,
  );
}

/**
 * The path of a location the admin API reports, as the page shows it: a
 * record key that holds a dot (`us.anthropic.claude-sonnet-4-6`) can't be
 * told apart in a dotted path, so the location is its record's.
 */
export function reportedPath(location: t.ReportedLocation): string {
  const { segments } = location;
  if (!Array.isArray(segments) || segments.length === 0) return location.path ?? '';
  const dotted = segments.findIndex((segment) => segment.includes('.'));
  return (dotted === -1 ? segments : segments.slice(0, Math.max(dotted, 1))).join('.');
}

/** The reported items `keep` accepts that name a location, with the panel's reasons. */
function toSkippedChanges(
  items: t.ReportedSkip[] | undefined,
  fallback: t.SkipReason,
  keep: (item: t.ReportedSkip) => boolean,
): t.SkippedChange[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item): t.SkippedChange[] => {
    const fieldPath = reportedPath(item);
    if (fieldPath === '' || !keep(item)) return [];
    return [{ fieldPath, reason: REPORTED_SKIP_REASONS[item.reason] ?? fallback }];
  });
}

/** A reported location key by key: its `segments`, else its dotted `path`. */
function segmentsOf(location: t.ReportedLocation): string[] {
  const { segments } = location;
  if (Array.isArray(segments) && segments.length > 0) return segments;
  return (location.path ?? '').split('.');
}

/**
 * Where a credential the merge leaves out is set together with the destination
 * it is sent to (`secretRebinding`): its entry in a record of named entries
 * (`mcpServers.github` for `mcpServers.github.apiKey.key`, `CREDENTIAL_ENTRY_RECORDS`),
 * else the object that holds it (`ocr` for `ocr.apiKey`).
 */
function credentialOwner(segments: readonly string[]): string {
  for (let depth = 1; depth < segments.length; depth++) {
    const edited = CREDENTIAL_ENTRY_RECORDS.get(segments.slice(0, depth).join('.'));
    if (edited) return entryLocation(edited, segments[depth]);
  }
  return segments.slice(0, Math.max(segments.length - 1, 1)).join('.');
}

/**
 * What a write's reply says did not take effect, with the panel's reasons:
 * each location it did not store (`skipped`), then each stored value the
 * runtime merge leaves out (`ignored`). `ignored` describes the whole stored
 * document, and a value sent as a whole collection can carry parts the save
 * did not change, so with the locations the save changes (`changed`,
 * `WritePlan.changed`) only an item whose owner the save changed is kept
 * (`credentialOwner`: the custom endpoint, MCP server or object it is set
 * in). A location a write addressed as a whole is one the save changed, so
 * it is always kept. A save elsewhere, even in the same section, does not
 * repeat an item, and one that no longer applies is not reported.
 */
function collectReport(
  body: t.PatchFieldsResponse,
  lists: { skipped: boolean; ignored: boolean },
  changed?: t.PathIndex,
): t.SkippedChange[] {
  const owned = (item: t.ReportedSkip): boolean =>
    !changed || pathIndexOverlaps(changed, credentialOwner(segmentsOf(item)));
  return [
    ...(lists.skipped ? toSkippedChanges(body.skipped, 'notStored', owned) : []),
    ...(lists.ignored ? toSkippedChanges(body.ignored, 'notApplied', owned) : []),
  ];
}

/**
 * What a field write's reply says did not take effect (`collectReport`):
 * `skipped` from a server with `writeReport`, `ignored` with `writeReport`
 * or from one that drops credentials (`secretRebinding`).
 */
export function readWriteReport(
  body: t.PatchFieldsResponse,
  features: t.ConfigFeatures,
  changed?: t.PathIndex,
): t.SkippedChange[] {
  const lists = {
    skipped: features.writeReport,
    ignored: features.writeReport || features.secretRebinding,
  };
  return collectReport(body, lists, changed);
}

/**
 * What a `POST …/changes` reply says did not take effect (`changesBatch`,
 * `collectReport`): a batch reply always lists what it did not store
 * (`skipped`) and what the runtime merge does not use (`ignored`, its
 * dropped credentials for the whole stored document).
 */
export function readBatchReport(
  body: t.PatchFieldsResponse,
  changed: t.PathIndex,
): t.SkippedChange[] {
  return collectReport(body, { skipped: true, ignored: true }, changed);
}
