import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  getWriteRules,
  resolveWriteRules,
  getReadOnlyReason,
  isBaseOnlyPath,
  isYamlManagedPath,
  isStartupOnlyPath,
  BUNDLED_WRITE_RULES,
  YAML_MANAGED_FIELDS,
  STARTUP_ONLY_FIELDS,
  CONFIG_FEATURE_FLAGS,
  BUNDLED_CONFIG_RULES,
  BUNDLED_CONFIG_LIMITS,
  BUNDLED_CONFIG_CONTRACT,
  BUNDLED_CONFIG_FEATURES,
  READ_ONLY_CONFIG_SECTIONS,
} from '@/constants';
import { resolveConfigContract, foldsEndpointReferences } from './contract';
import { createServerContract } from '@/test/fixtures';

describe('resolveConfigContract', () => {
  it('is the bundled contract, every feature off, for a server without the meta route', () => {
    const contract = resolveConfigContract(null);
    expect(contract).toBe(BUNDLED_CONFIG_CONTRACT);
    expect(contract.source).toBe('bundled');
    expect(Object.values(contract.features).every((on) => on === false)).toBe(true);
    expect(Object.keys(contract.features).sort()).toEqual([...CONFIG_FEATURE_FLAGS].sort());
  });

  it('turns on exactly the flags the server reports as true', () => {
    const contract = resolveConfigContract({
      features: { dottedKeys: true, webSearchStoredKeys: false, someFutureFlag: true },
    });
    expect(contract.source).toBe('server');
    expect(contract.features.dottedKeys).toBe(true);
    expect(contract.features.webSearchStoredKeys).toBe(false);
    expect(contract.features.changesBatch).toBe(false);
    expect(contract.features).not.toHaveProperty('someFutureFlag');
  });

  it('fills limits and rules the server leaves out from the bundled ones', () => {
    const contract = resolveConfigContract({
      limits: { maxPatchEntries: 50, maxChangeOps: undefined },
      rules: {
        titleResolution: 'field',
        baseOnlyPaths: ['endpoints.agents.pullRequests.provider'],
      },
    });
    expect(contract.limits).toEqual({ ...BUNDLED_CONFIG_LIMITS, maxPatchEntries: 50 });
    expect(contract.rules).toEqual({
      ...BUNDLED_CONFIG_RULES,
      titleResolution: 'field',
      baseOnlyPaths: ['endpoints.agents.pullRequests.provider'],
    });
  });

  it('reads the read-API flags and the catalog model-list lifetime, each off or bundled when left out', () => {
    const contract = resolveConfigContract({
      features: { resolvedApi: true, catalogApi: true, envStatus: true },
      limits: { catalogModelsTtlMs: 0 },
    });
    expect(contract.features).toMatchObject({
      resolvedApi: true,
      catalogApi: true,
      envStatus: true,
    });
    expect(contract.limits.catalogModelsTtlMs).toBe(0);
    const older = resolveConfigContract({ features: { changesBatch: true } });
    expect(older.features).toMatchObject({
      resolvedApi: false,
      catalogApi: false,
      envStatus: false,
    });
    expect(older.limits.catalogModelsTtlMs).toBe(BUNDLED_CONFIG_LIMITS.catalogModelsTtlMs);
  });

  it('reads the re-derive flags and the derived paths, off and none when left out', () => {
    const contract = resolveConfigContract({
      features: {
        azureGroupMergeKey: true,
        customParamsExpansion: true,
        specInterfaceRederive: true,
        endpointRederive: true,
      },
      rules: { derivedPaths: ['endpoints.anthropic.vertexConfig'] },
    });
    expect(contract.features).toMatchObject({
      azureGroupMergeKey: true,
      customParamsExpansion: true,
      specInterfaceRederive: true,
      endpointRederive: true,
    });
    expect(contract.rules.derivedPaths).toEqual(['endpoints.anthropic.vertexConfig']);
    const older = resolveConfigContract({ features: { azureGroupSecrets: true } });
    expect(older.features).toMatchObject({
      azureGroupMergeKey: false,
      customParamsExpansion: false,
      specInterfaceRederive: false,
      endpointRederive: false,
    });
    expect(older.rules.derivedPaths).toEqual([]);
  });

  it('reports versions only when all three are given', () => {
    const versions = { librechat: 'v0.8.9', dataProvider: '0.8.528', configSchema: '1.3.18' };
    expect(resolveConfigContract({ versions }).versions).toEqual(versions);
    expect(resolveConfigContract({ versions: { librechat: 'v0.8.9' } }).versions).toBeUndefined();
  });
});

describe('BUNDLED_CONFIG_RULES', () => {
  it('mirrors what LibreChat enforced before it reported its rules', () => {
    expect(BUNDLED_CONFIG_RULES.arrayMergeKeys).toEqual({ 'endpoints.custom': 'name' });
    expect(BUNDLED_CONFIG_RULES.arraySecretFields).toEqual([
      {
        arrayPath: 'endpoints.custom',
        secretKey: 'apiKey',
        previewKey: 'apiKeyPreview',
        identityKey: 'name',
      },
    ]);
    expect(BUNDLED_CONFIG_RULES.overrideKeyMap).toEqual({
      interface: 'interfaceConfig',
      turnstile: 'turnstileConfig',
      mcpServers: 'mcpConfig',
    });
    expect(BUNDLED_CONFIG_RULES.baseOnlySections).toEqual(
      expect.arrayContaining(['filters', 'mcpAppSandbox']),
    );
    expect(BUNDLED_CONFIG_RULES.recordSecretFields).toEqual([]);
    expect(BUNDLED_CONFIG_RULES.titleResolution).toBe('block');
    expect(BUNDLED_CONFIG_RULES.secretFields).toContainEqual({
      path: 'langfuse.secretKey',
      previewPath: 'langfuse.secretKeyPreview',
      allowEnvPlaceholder: false,
    });
  });
});

/** `rules.deploymentOnlyPaths` as LibreChat with the write report publishes it (abridged). */
const DEPLOYMENT_ONLY: t.ConfigRules['deploymentOnlyPaths'] = {
  rateLimits: 'operator',
  cloudfront: 'operator',
  includedTools: 'operator',
  skillDeletion: 'startup',
  cache: 'unused',
  'registration.oauthStateTtlMs': 'startup',
  'endpoints.agents.eventDriven': 'startup',
  'endpoints.agents.toolApproval.hooks': 'operator',
};

describe('write rules', () => {
  it('keeps the read-only sections and fields the panel knew for a server without rules', () => {
    expect(getWriteRules(BUNDLED_CONFIG_CONTRACT)).toBe(BUNDLED_WRITE_RULES);
    expect([...BUNDLED_WRITE_RULES.readOnlySections].sort()).toEqual(
      [...READ_ONLY_CONFIG_SECTIONS].sort(),
    );
    expect(Object.fromEntries(READ_ONLY_CONFIG_SECTIONS)).toEqual({
      filters: 'baseOnly',
      mcpAppSandbox: 'baseOnly',
      cloudfront: 'yamlOnly',
      rateLimits: 'yamlOnly',
      turnstile: 'yamlOnly',
      permissions: 'yamlOnly',
      openapi: 'yamlOnly',
      cache: 'yamlOnly',
      clientLimits: 'yamlOnly',
      telemetry: 'yamlOnly',
      conversationList: 'yamlOnly',
      passwordHashing: 'yamlOnly',
    });
    expect(YAML_MANAGED_FIELDS).toEqual(BUNDLED_WRITE_RULES.yamlManagedFields);
    expect(isYamlManagedPath('registration.socialLogins')).toBe(true);
    expect(isYamlManagedPath('endpoints.azureOpenAI.groups.0.apiKey')).toBe(true);
    expect(isStartupOnlyPath('mcpSettings.catalogRecovery.maxStateEntries')).toBe(true);
    expect(STARTUP_ONLY_FIELDS.has('mcpSettings.catalogRecovery.authorizationFenceTimeoutMs')).toBe(
      false,
    );
  });

  it("reads sections and fields from a server's base-only and deployment-only lists", () => {
    const rules = resolveWriteRules(
      {
        baseOnlySections: ['filters', 'mcpAppSandbox', 'turnstile'],
        baseOnlyPaths: ['endpoints.agents.pullRequests.provider'],
        deploymentOnlyPaths: DEPLOYMENT_ONLY,
        derivedPaths: [],
      },
      { ...BUNDLED_CONFIG_FEATURES, preAuthBaseOverrides: false },
    );
    expect(getReadOnlyReason('includedTools', rules)).toBe('yamlOnly');
    expect(getReadOnlyReason('skillDeletion.intervalMs', rules)).toBe('yamlOnly');
    expect(getReadOnlyReason('filters.pii', rules)).toBe('baseOnly');
    expect(getReadOnlyReason('turnstile.siteKey', rules)).toBe('yamlOnly');
    expect(getReadOnlyReason('permissions', rules)).toBeUndefined();
    expect(isYamlManagedPath('endpoints.agents.pullRequests.provider', rules)).toBe(true);
    expect(isYamlManagedPath('endpoints.agents.pullRequests.host', rules)).toBe(false);
    expect(isYamlManagedPath('endpoints.agents.toolApproval.hooks.0', rules)).toBe(true);
    expect(isStartupOnlyPath('endpoints.agents.eventDriven', rules)).toBe(true);
    expect(isStartupOnlyPath('endpoints.agents.toolApproval.hooks', rules)).toBe(false);
    expect(isStartupOnlyPath('mcpSettings.catalogRecovery.maxStateEntries', rules)).toBe(false);
  });

  it('keeps what LibreChat reads from librechat.yaml without listing it read-only on every server', () => {
    const server = resolveWriteRules(
      {
        baseOnlySections: ['filters', 'mcpAppSandbox', 'turnstile'],
        baseOnlyPaths: [],
        deploymentOnlyPaths: { ...DEPLOYMENT_ONLY, 'telemetry.stackTraceLimit': 'operator' },
        derivedPaths: [],
      },
      BUNDLED_CONFIG_FEATURES,
    );
    for (const rules of [server, BUNDLED_WRITE_RULES]) {
      expect(getReadOnlyReason('clientLimits.refreshMs', rules)).toBe('yamlOnly');
      expect(getReadOnlyReason('telemetry.rum.enabled', rules)).toBe('yamlOnly');
      expect(getReadOnlyReason('conversationList.maxEndpointNameLength', rules)).toBe('yamlOnly');
      expect(getReadOnlyReason('passwordHashing.maxWorkers', rules)).toBe('yamlOnly');
      expect(getReadOnlyReason('interface.colorModeFromUrl', rules)).toBeUndefined();
      expect(isYamlManagedPath('fileConfig.skills.deletionCleanupConcurrency', rules)).toBe(true);
      expect(isStartupOnlyPath('fileConfig.skills.deletionCleanupConcurrency', rules)).toBe(false);
      expect(isYamlManagedPath('fileConfig.skills.importCleanupConcurrency', rules)).toBe(false);
      expect(isStartupOnlyPath('interface.colorModeFromUrl', rules)).toBe(true);
      expect(isYamlManagedPath('interface.landingFooter', rules)).toBe(false);
    }
    expect(isYamlManagedPath('telemetry.stackTraceLimit', server)).toBe(true);
    expect(getReadOnlyReason('skillSync.github.enabled', server)).toBeUndefined();
  });

  it('lets Base set the social sign-in buttons once Base overrides apply before sign-in', () => {
    const before = getWriteRules(createServerContract());
    const after = getWriteRules(createServerContract({ preAuthBaseOverrides: true }));
    expect(isYamlManagedPath('registration.socialLogins', before)).toBe(true);
    expect(isYamlManagedPath('registration.socialLogins', after)).toBe(false);
    expect(isYamlManagedPath('registration.oauthStateTtlMs', after)).toBe(true);
    expect(isYamlManagedPath('endpoints.anthropic.vertex.region', after)).toBe(true);
  });

  it('lets the panel edit Azure groups and Vertex AI only where LibreChat derives them again', () => {
    const groups = 'endpoints.azureOpenAI.groups.0.instanceName';
    const vertex = 'endpoints.anthropic.vertex.projectId';
    const inert = getWriteRules(
      createServerContract({ azureGroupMergeKey: true, azureGroupSecrets: true }),
    );
    expect(isYamlManagedPath(groups, inert)).toBe(true);
    expect(isYamlManagedPath(vertex, inert)).toBe(true);
    const rederive = getWriteRules(
      createServerContract(
        { endpointRederive: true, azureGroupMergeKey: true, azureGroupSecrets: true },
        {
          baseOnlyPaths: [
            'endpoints.anthropic.vertex.serviceKeyFile',
            'endpoints.anthropic.vertex.region',
          ],
          derivedPaths: ['endpoints.anthropic.vertexConfig'],
        },
      ),
    );
    expect(isYamlManagedPath(groups, rederive)).toBe(false);
    expect(isYamlManagedPath(vertex, rederive)).toBe(false);
    expect(isYamlManagedPath('endpoints.anthropic.vertex.region', rederive)).toBe(true);
    expect(isBaseOnlyPath('endpoints.anthropic.vertex.serviceKeyFile', rederive)).toBe(true);
    expect(isBaseOnlyPath(vertex, rederive)).toBe(false);
    expect(isYamlManagedPath('endpoints.anthropic.vertexConfig.models', rederive)).toBe(true);
    const withoutMergeKey = getWriteRules(createServerContract({ endpointRederive: true }));
    expect(isYamlManagedPath(groups, withoutMergeKey)).toBe(true);
    expect(isYamlManagedPath(vertex, withoutMergeKey)).toBe(false);
  });

  it('builds the rules once per contract', () => {
    const contract = createServerContract({ preAuthBaseOverrides: true });
    expect(getWriteRules(contract)).toBe(getWriteRules(contract));
  });
});

describe('foldsEndpointReferences', () => {
  it('is reported by per-field title resolution, which shipped with it', () => {
    expect(foldsEndpointReferences(BUNDLED_CONFIG_CONTRACT)).toBe(false);
    expect(foldsEndpointReferences(createServerContract({}, { titleResolution: 'field' }))).toBe(
      true,
    );
  });
});
