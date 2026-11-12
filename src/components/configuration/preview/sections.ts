import yaml from 'js-yaml';
import type * as t from '@/types';
import { isConfigValueEqual, maskStoredSecrets, getValueAtPath } from '@/utils';
import { SECTION_META, fallbackSectionTitle } from '../configMeta';
import { AZURE_GROUPS_PATH } from '@/constants';

/** Settings LibreChat reads from librechat.yaml alone until its operator sets CONFIG_REDERIVE_ENDPOINTS. */
const REDERIVED_SETTINGS: readonly string[] = [AZURE_GROUPS_PATH, 'endpoints.anthropic.vertex'];

/** Whether a tombstone at `path` hides `setting`, part of it, or a section holding it. */
function hidesPartOf(path: string, setting: string): boolean {
  return (
    path === setting ||
    path.startsWith(`${setting}.`) ||
    path.startsWith(`${setting}[`) ||
    setting.startsWith(`${path}.`)
  );
}

/**
 * Whether an applied document of `preview` sets or hides Azure groups or
 * Vertex AI where the server stores them but applies neither until its
 * operator turns re-derivation on (`azureGroupMergeKey` without
 * `endpointRederive`): the result shows them merged, while members get
 * librechat.yaml's.
 */
export function mergesUnappliedSettings(
  preview: t.ConfigPreview,
  features: t.ConfigFeatures,
): boolean {
  if (!features.azureGroupMergeKey || features.endpointRederive) return false;
  return preview.layers.some(
    (layer) =>
      layer.isActive &&
      REDERIVED_SETTINGS.some(
        (setting) =>
          getValueAtPath(layer.overrides, setting) !== undefined ||
          layer.tombstones.some((path) => hidesPartOf(path, setting)),
      ),
  );
}

function sectionLabel(key: string, localize: t.LocalizeFn): string {
  const meta = SECTION_META[key];
  return meta ? localize(meta.titleKey) : fallbackSectionTitle(key);
}

/**
 * The top-level sections of a previewed config, in the result's order and
 * then librechat.yaml's, each with whether the result differs from
 * librechat.yaml (an admin override changes it).
 */
export function previewSections(
  preview: t.ConfigPreview,
  localize: t.LocalizeFn,
): t.PreviewSection[] {
  const keys = new Set([...Object.keys(preview.resolved), ...Object.keys(preview.yaml)]);
  return Array.from(keys, (key) => ({
    key,
    label: sectionLabel(key, localize),
    changed: !isConfigValueEqual(preview.resolved[key], preview.yaml[key]),
  }));
}

/**
 * A previewed tree as YAML. The server withholds secrets; anything still under
 * a key the panel's secret rule names is masked here too
 * (`maskStoredSecrets`), while the references LibreChat's reads keep readable
 * stay as written: `${VAR}`, a `user_provided` endpoint or Azure group key,
 * an MCP server's `{{VAR}}` credential.
 */
export function formatPreviewYaml(value: t.ConfigValue): string {
  return yaml
    .dump(maskStoredSecrets(value), {
      lineWidth: 120,
      noRefs: true,
      skipInvalid: true,
    })
    .trimEnd();
}

/** Where part of a document is, as the preview lists it (`endpoints › custom › Ollama › apiKey`). */
export function formatSegments(segments: readonly string[]): string {
  return segments.join(' › ');
}
