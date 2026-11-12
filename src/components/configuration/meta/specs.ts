import type * as t from '@/types';

/**
 * Model spec field metadata (WS11): labels and help where the schema's own
 * read wrong in the spec editor, the review and search.
 */
export const SPEC_FIELD_META: t.FieldMetaRegistry = {
  'modelSpecs.list': { labelKey: 'com_config_specs_list' },
  /** LibreChat lists specs in list order; `order` sorts nothing in its model menu. */
  'modelSpecs.list[].order': { descriptionKey: 'com_config_specs_order_desc' },
  /** The provider's own search tool, apart from the spec's Web search capability. */
  'modelSpecs.list[].preset.web_search': { labelKey: 'com_config_specs_provider_web_search' },
  'modelSpecs.list[].preset.greeting': { multiline: true },
  'modelSpecs.list[].preset.modelLabel': {
    placeholderKey: 'com_config_specs_model_label_placeholder',
  },
  /** Unset, the spec's agent gets no ask-the-user tool. */
  'modelSpecs.list[].askUserQuestion': { runtimeDefault: false },
  /** Unset, LibreChat lets the provider pick (the parameter panel's "Auto"). */
  ...Object.fromEntries(
    [
      'effort',
      'reasoning_effort',
      'reasoning_summary',
      'reasoning_mode',
      'reasoning_context',
      'verbosity',
      'thinkingLevel',
    ].map((key) => [
      `modelSpecs.list[].preset.${key}`,
      { defaultLabelKey: 'com_config_specs_default_auto' },
    ]),
  ),
  'modelSpecs.list[].preset.promptCacheTtl': {
    defaultLabelKey: 'com_config_specs_default_provider',
  },
};
