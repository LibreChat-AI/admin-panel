import '@/locales/i18n';
import { describe, it, expect } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import { buildFieldMetaRegistry, resolveFieldMeta } from './registry';
import { getFieldMeta, labelForPath, descriptionKeyForPath } from '.';
import { extractSchemaTree } from '@/server/config';
import { localizeEn } from '@/test/coverage';

const localize: t.LocalizeFn = (key) =>
  ({ com_config_field_tokenLimit: 'Token limit', com_config_field_custom: 'Custom' })[key] ?? key;

describe('resolveFieldMeta', () => {
  const root = buildFieldMetaRegistry([
    {
      'balance.startBalance': { unit: 'credits' },
      'endpoints.custom[].models.default': { labelKey: 'default_models' },
      'mcpServers.{}.startup': { runtimeDefault: true },
      'mcpServers.github.startup': { runtimeDefault: false },
      'endpoints.custom.[].name': { width: 'M' },
    },
    { 'balance.startBalance': { labelKey: 'start' } },
  ]);

  it('resolves exact paths and merges later registries over earlier ones', () => {
    expect(resolveFieldMeta(root, 'balance.startBalance')).toEqual({
      unit: 'credits',
      labelKey: 'start',
    });
  });

  it('matches array indices against [] in either spelling', () => {
    expect(resolveFieldMeta(root, 'endpoints.custom.3.models.default')?.labelKey).toBe(
      'default_models',
    );
    expect(resolveFieldMeta(root, 'endpoints.custom.0.name')?.width).toBe('M');
  });

  it('matches record keys against {} and prefers literal segments', () => {
    expect(resolveFieldMeta(root, 'mcpServers.cloudflare.startup')?.runtimeDefault).toBe(true);
    expect(resolveFieldMeta(root, 'mcpServers.github.startup')?.runtimeDefault).toBe(false);
  });

  it('accepts schema paths with [] markers but keeps [] and {} distinct', () => {
    expect(resolveFieldMeta(root, 'endpoints.custom.[].name')?.width).toBe('M');
    expect(resolveFieldMeta(root, 'endpoints.custom.{}.name')).toBeUndefined();
  });

  it('returns undefined for unknown or partial paths', () => {
    expect(resolveFieldMeta(root, 'balance')).toBeUndefined();
    expect(resolveFieldMeta(root, 'balance.startBalance.extra')).toBeUndefined();
  });
});

describe('getFieldMeta / labelForPath', () => {
  it('resolves generic metadata and suffix-derived units', () => {
    expect(getFieldMeta('balance.startBalance')).toMatchObject({ unit: 'credits' });
    expect(getFieldMeta('balance.reservationTtlMs')).toMatchObject({ unit: 'ms' });
    expect(getFieldMeta('rateLimits.fileUploads.ipWindowInMinutes')).toEqual({
      unit: 'minutes',
      runtimeDefault: 15,
    });
    expect(getFieldMeta('mcpServers.github.chatMenu')?.runtimeDefault).toBe(true);
    expect(getFieldMeta('modelSpecs.list.2.showInMenu')?.runtimeDefault).toBe(true);
    expect(getFieldMeta('version')).toBeUndefined();
    expect(getFieldMeta('endpoints.openAI.titlePrompt')).toMatchObject({ multiline: true });
    expect(getFieldMeta('webSearch.jinaApiKey')).toEqual({ secret: true });
    expect(getFieldMeta('fileStrategy')).toMatchObject({ confirmChange: true });
  });

  it('reads seconds and bytes from the key, but no unit from a rate per minutes', () => {
    expect(getFieldMeta('emailChange.tokenTTLSeconds')?.unit).toBe('s');
    expect(getFieldMeta('endpoints.agents.pullRequests.cacheTtlSeconds')?.unit).toBe('s');
    expect(getFieldMeta('interface.historyCacheMaxBytes')?.unit).toBe('bytes');
    expect(getFieldMeta('endpoints.agents.fileSharing.maxPrivateBytes')?.unit).toBe('bytes');
    expect(getFieldMeta('skillSync.github.intervalMinutes')?.unit).toBe('minutes');
    expect(
      getFieldMeta('rateLimits.twoFactorManagement.requestsPerFiveMinutes')?.unit,
    ).toBeUndefined();
  });

  it("never names a time or size unit in a label beside the control's own", () => {
    const unitWords: Partial<Record<t.FieldUnit, readonly string[]>> = {
      ms: ['ms', 'milliseconds'],
      s: ['seconds'],
      minutes: ['minutes'],
      hours: ['hours'],
      bytes: ['bytes'],
      MB: ['mb'],
    };
    const fields: t.SchemaField[] = [];
    const collect = (list: t.SchemaField[]) =>
      list.forEach((field) => {
        fields.push(field);
        collect(field.children ?? []);
      });
    collect(extractSchemaTree(configSchema));
    const doubled = fields.flatMap((field) => {
      const unit = getFieldMeta(field.path)?.unit;
      const words = new Set(
        labelForPath(field.path, localizeEn)
          .toLowerCase()
          .split(/[\s()]+/),
      );
      const names = unit ? (unitWords[unit] ?? []) : [];
      return names.some((name) => words.has(name)) ? [field.path] : [];
    });
    expect(doubled).toEqual([]);
  });

  it('flags read-only sections and permission paths', () => {
    expect(getFieldMeta('cloudfront')?.yamlOnly).toBe(true);
    expect(getFieldMeta('skillSync')?.yamlOnly).toBe(true);
    expect(getFieldMeta('filters')?.baseOnly).toBe(true);
    expect(getFieldMeta('interface.prompts')?.permission).toBe(true);
    expect(getFieldMeta('interface.schedules.use')?.permission).toBe(true);
    expect(getFieldMeta('interface.schedules')?.permission).toBeUndefined();
  });

  it('shares one description per endpoint field and labels by path', () => {
    expect(descriptionKeyForPath('endpoints.openAI.titleConvo')).toBe(
      'com_config_desc_endpoint_titleConvo',
    );
    expect(descriptionKeyForPath('endpoints.custom.[].titleConvo')).toBe(
      'com_config_desc_endpoint_titleConvo',
    );
    expect(descriptionKeyForPath('mcpServers.{}.startup')).toBe(
      'com_config_desc_mcpServers_startup',
    );
    expect(descriptionKeyForPath('modelSpecs.list.[].preset.model')).toBe(
      'com_config_desc_modelSpecs_list_preset_model',
    );
    expect(labelForPath('endpoints.custom.4.models.default', (key) => key)).toBe(
      'com_config_label_models_default',
    );
  });

  it('labels a path by its last named segment', () => {
    expect(labelForPath('memory.tokenLimit', localize)).toBe('Token limit');
    expect(labelForPath('endpoints.custom.3', localize)).toBe('Custom');
  });

  it('falls back to the key when there is no translation', () => {
    expect(labelForPath('mcpServers.cloudflare', localize)).toBe('cloudflare');
  });
});

describe('what LibreChat does with unset switches', () => {
  it('names the runtime default of switches LibreChat reads as off or on when unset', () => {
    expect(getFieldMeta('interface.retainAgentFiles')?.runtimeDefault).toBe(false);
    expect(getFieldMeta('interface.privacyPolicy.openNewTab')?.runtimeDefault).toBe(false);
    expect(getFieldMeta('fileConfig.textFallbackWithoutTools')?.runtimeDefault).toBe(false);
    expect(getFieldMeta('mcpServers.github.oauth.skip_code_challenge_check')?.runtimeDefault).toBe(
      false,
    );
    expect(
      getFieldMeta('endpoints.agents.askUserQuestion.retainedAnswers.enabled')?.runtimeDefault,
    ).toBe(true);
    expect(
      getFieldMeta('endpoints.custom.3.customParams.paramDefinitions.0.showLabel')?.runtimeDefault,
    ).toBe(true);
  });

  it('keeps the other metadata of a path it adds a default to', () => {
    expect(getFieldMeta('speech.speechTab.speechToText')).toMatchObject({
      labelKey: 'com_config_label_speechTab_speechToText',
      runtimeDefault: true,
    });
    expect(getFieldMeta('mcpServers.github.serverInstructions')).toMatchObject({
      multiline: true,
      runtimeDefault: false,
    });
    expect(getFieldMeta('modelSpecs.list.0.artifacts')?.runtimeDefault).toBe(false);
  });

  it('names the service that decides a flag LibreChat only passes on', () => {
    expect(getFieldMeta('webSearch.firecrawlOptions.blockAds')?.defaultLabelKey).toBe(
      'com_config_default_firecrawl_decides',
    );
    expect(getFieldMeta('mcpServers.github.requiresOAuth')?.defaultLabelKey).toBe(
      'com_config_default_auto_detect',
    );
    expect(getFieldMeta('endpoints.agents.toolApproval.enabled')?.runtimeDefault).toBeUndefined();
  });
});
