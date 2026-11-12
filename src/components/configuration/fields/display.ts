import type * as t from '@/types';

/**
 * Single-line input look shared by native inputs and selects: the click-ui
 * fields' 32px height and their field tokens (background, stroke, text and
 * placeholder), so a masked key or a select sits next to a click-ui text
 * field without a different fill in either theme.
 */
export const INPUT_CLASSES =
  'h-8 w-full min-w-0 rounded-(--cui-radii-sm) border border-solid border-(--click-field-color-stroke-default) bg-(--click-field-color-background-default) px-3 text-sm text-(--click-field-color-text-default) outline-none placeholder:text-(--click-field-color-placeholder-default) hover:border-(--click-field-color-stroke-hover) focus:border-(--click-field-color-stroke-active) focus:bg-(--click-field-color-background-active) disabled:cursor-default disabled:border-transparent disabled:bg-transparent aria-invalid:border-(--cui-color-text-danger)';

/** Width classes for a control (S: short numbers, M: identifiers, L: URLs and prompts). */
export function widthClass(width?: t.ControlWidth): string {
  if (width === 'S') return 'max-w-40';
  if (width === 'L') return 'max-w-150';
  return 'max-w-75';
}

function scalarText(value: string | number | boolean, localize: t.LocalizeFn): string {
  if (typeof value === 'boolean')
    return localize(value ? 'com_config_ctl_on' : 'com_config_ctl_off');
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

/** Short display of a default value for option labels and placeholders. */
export function formatDefaultValue(
  value: t.ConfigValue,
  localize: t.LocalizeFn,
  optionLabels?: Record<string, string>,
): string | null {
  if (value === undefined || value === null || typeof value === 'object') return null;
  const label = optionLabels?.[String(value)] ?? scalarText(value, localize);
  return label.length > 40 ? `${label.slice(0, 37)}…` : label;
}

/** Label of the "Default" choice: names the layer the value comes from and the value. */
export function defaultChoiceLabel(
  fieldDefault: Pick<t.FieldDefault, 'value' | 'source' | 'fromGlobal'>,
  localize: t.LocalizeFn,
  optionLabels?: Record<string, string>,
): string {
  const shown = formatDefaultValue(fieldDefault.value, localize, optionLabels);
  if (shown == null) return localize('com_config_ctl_default_unknown');
  if (fieldDefault.fromGlobal) return localize('com_config_ctl_default_global', { value: shown });
  if (fieldDefault.source === 'yaml')
    return localize('com_config_ctl_default_yaml', { value: shown });
  if (fieldDefault.source === 'inherited') {
    return localize('com_config_ctl_default_inherited', { value: shown });
  }
  return localize('com_config_ctl_default_value', { value: shown });
}
