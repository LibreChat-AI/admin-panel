import type * as t from '@/types';
import { MEMORY_AGENT_KEYS, TRIGGER_RULES } from '@/constants';
import { layerValueBeneath } from '../../renderer/defaults';
import { isEnvReference } from '@/utils';

const ENV_NAME = /^\$\{([A-Za-z0-9_]+)\}$/;

/** `${SERPER_API_KEY}` → `SERPER_API_KEY`. */
export function envName(value: t.ConfigValue): string | undefined {
  return typeof value === 'string' ? ENV_NAME.exec(value)?.[1] : undefined;
}

/**
 * Where a web search credential's value comes from (FX-2): a value queued for
 * the next save, a stored (encrypted) secret, an environment variable it
 * references, a literal value, the environment variable LibreChat reads when
 * nothing is set, or nothing at all.
 */
export function credentialState({
  value,
  fieldDefault,
  secretPreview,
  hasPendingEdit,
  credential,
}: Pick<t.FieldControlProps, 'value' | 'fieldDefault' | 'secretPreview' | 'hasPendingEdit'> & {
  credential: t.WebSearchCredential;
}): t.CredentialState {
  const own = typeof value === 'string' && value !== '' ? value : undefined;
  if (hasPendingEdit && own && !isEnvReference(own)) return { status: 'pending' };
  if (secretPreview && !hasPendingEdit) return { status: 'stored', preview: secretPreview };
  if (own) {
    const env = envName(own);
    return env ? { status: 'env', env } : { status: 'set' };
  }
  /** Unset, LibreChat falls back to the environment variable (`loadWebSearchConfig` uses `??`, so `''` stays empty). */
  if (value === undefined) {
    return { status: 'default', env: envName(fieldDefault.value) ?? credential.env };
  }
  return { status: 'missing', env: credential.env };
}

/** Whether the layer beneath the edit target (librechat.yaml in Base, Base in a profile) sets a field. */
function lowerSets(state: t.FieldState): boolean {
  return layerValueBeneath(state) !== undefined;
}

/** Whether a memory agent key is hidden (stored tombstone) or queued to be hidden. */
export function isAgentKeyHidden(
  state: t.FieldState | undefined,
  visibility: t.VisibilityEdit | undefined,
): boolean {
  if (visibility) return visibility === 'hide';
  return state?.isHidden ?? false;
}

/**
 * The writes that switch the memory agent to `next` (FX-3). LibreChat merges
 * an override over librechat.yaml key by key and validates the result, so a
 * key of the other definition that the layer beneath sets (the YAML `id`)
 * must be hidden, not just left out; keys only the edit target sets are
 * removed. Keys of `next` hidden earlier in this edit are shown again, keys
 * of `next` a saved tombstone hides (the switch away was saved) are
 * unhidden, and removals of `next`'s own keys queued by the switch away are
 * dropped, so the definition switched back to applies again.
 */
export function planAgentSwitch(
  next: t.MemoryAgentMode,
  path: string,
  states: Readonly<Record<string, t.FieldState>>,
  visibility: Readonly<Record<string, t.VisibilityEdit>>,
  editedValues: t.FlatConfigMap | undefined,
): t.MemoryAgentSwitch {
  const other: t.MemoryAgentMode = next === 'id' ? 'inline' : 'id';
  const plan: t.MemoryAgentSwitch = { hide: [], reset: [], unhide: [], discard: [], show: [] };
  for (const key of MEMORY_AGENT_KEYS[next]) {
    const keyPath = `${path}.${key}`;
    const edit = visibility[keyPath];
    if (edit === 'hide') plan.unhide.push(keyPath);
    else if (edit === undefined && states[keyPath]?.isHidden) plan.show.push(keyPath);
    if (editedValues != null && keyPath in editedValues && editedValues[keyPath] === undefined) {
      plan.discard.push(keyPath);
    }
  }
  for (const key of MEMORY_AGENT_KEYS[other]) {
    const keyPath = `${path}.${key}`;
    const state = states[keyPath];
    if (!state) continue;
    const pending = editedValues != null && keyPath in editedValues;
    if (isAgentKeyHidden(state, visibility[keyPath])) {
      if (pending) plan.discard.push(keyPath);
      continue;
    }
    if (lowerSets(state)) {
      if (pending) plan.discard.push(keyPath);
      plan.hide.push(keyPath);
    } else if (state.isOverride) {
      plan.reset.push(keyPath);
    } else if (pending) {
      plan.discard.push(keyPath);
    }
  }
  return plan;
}

/** How the memory agent is defined in a value: by ID, inline, or not at all. */
export function agentMode(value: t.ConfigRecord): t.MemoryAgentMode | undefined {
  if (typeof value.id === 'string' && value.id !== '') return 'id';
  const inline = MEMORY_AGENT_KEYS.inline.some((key) => value[key] != null && value[key] !== '');
  return inline ? 'inline' : undefined;
}

/** Locale key of what is wrong with a trigger value, or null (FX-4). */
export function triggerIssue(type: string | undefined, value: number | undefined): string | null {
  const rule = type ? TRIGGER_RULES[type] : undefined;
  if (!rule) return null;
  if (value === undefined || Number.isNaN(value)) return 'com_config_features_trigger_required';
  if (rule.int && !Number.isInteger(value)) return 'com_config_features_trigger_int';
  if (value < rule.min || (rule.max !== undefined && value > rule.max)) {
    return `com_config_features_trigger_range_${type}`;
  }
  return null;
}

/** A summarization trigger read from a config value, if it is one. */
export function toTrigger(value: t.ConfigValue): t.TriggerValue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const type = typeof value.type === 'string' ? value.type : undefined;
  const amount = typeof value.value === 'number' ? value.value : undefined;
  return type === undefined && amount === undefined ? undefined : { type, value: amount };
}

/** "Default: …" / "Inherited: …" placeholder for a text control with nothing of its own. */
export function defaultPlaceholder(
  fieldDefault: t.FieldDefault,
  localize: t.LocalizeFn,
): string | undefined {
  const { value, hasOwnValue, source } = fieldDefault;
  if (hasOwnValue || value == null || typeof value === 'object' || value === '') return undefined;
  const key =
    source === 'inherited'
      ? 'com_config_ctl_placeholder_inherited'
      : 'com_config_ctl_placeholder_default';
  return localize(key, { value: String(value) });
}
