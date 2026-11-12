import type * as t from '@/types';

const ISSUE_KEYS: Readonly<Record<t.EndpointIssueCode, string>> = {
  nameRequired: 'com_config_ce_issue_name_required',
  nameWhitespace: 'com_config_ce_issue_name_whitespace',
  nameTaken: 'com_config_ce_issue_name_taken',
  nameSimilar: 'com_config_ce_issue_name_similar',
  nameMerged: 'com_config_ce_issue_name_merged',
  nameReserved: 'com_config_ce_issue_name_reserved',
  nameUnaddressable: 'com_config_ce_issue_name_unaddressable',
  apiKeyRequired: 'com_config_ce_issue_api_key_required',
  baseUrlRequired: 'com_config_ce_issue_base_url_required',
  baseUrlInvalid: 'com_config_ce_issue_base_url_invalid',
  modelsRequired: 'com_config_ce_issue_models_required',
  modelBlank: 'com_config_ce_issue_model_blank',
  modelDuplicate: 'com_config_ce_issue_model_duplicate',
  renameNeedsKey: 'com_config_ce_issue_rename_needs_key',
};

/** The sentence an endpoint problem is shown as, at its field or in the list. */
export function describeIssue(issue: t.EndpointIssue, localize: t.LocalizeFn): string {
  return localize(ISSUE_KEYS[issue.code], issue.params);
}
