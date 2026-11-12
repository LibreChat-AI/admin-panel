import { describe, expect, it } from 'vitest';
import { maskCredential, toAzureGroups } from '../azure';
import { BUNDLED_CONFIG_FEATURES } from '@/constants';
import { createField } from '@/test/fixtures';
import { providerTocItems } from '../layout';
import { providerStatus } from '../status';
import { addressIssue } from '@/utils';

describe('toAzureGroups', () => {
  it('reads groups as LibreChat serves them, blank values as unset', () => {
    const [row] = toAzureGroups([
      {
        group: 'eastus',
        apiKey: '${KEY}',
        instanceName: 'eus',
        deploymentName: '',
        baseURL: '',
        serverless: false,
        models: {
          'gpt-4.1': { deploymentName: 'd', version: 'v', assistants: true },
          'gpt-4o': true,
        },
        region: 'eastus',
        additionalHeaders: { 'api-key': 'secret', n: 3 },
        dropParams: ['stop', 4],
      },
      'junk',
      { noGroup: true },
    ]);
    expect(row).toMatchObject({
      group: 'eastus',
      instanceName: 'eus',
      deploymentName: undefined,
      baseURL: undefined,
      serverless: false,
      assistants: false,
      additionalHeaders: { 'api-key': 'secret' },
      dropParams: ['stop'],
      others: { region: 'eastus' },
    });
    expect(row.models).toEqual([
      { name: 'gpt-4.1', deploymentName: 'd', version: 'v', others: { assistants: true } },
      { name: 'gpt-4o', others: {} },
    ]);
    expect(toAzureGroups(null)).toEqual([]);
  });
});

describe('maskCredential', () => {
  it('names an environment reference and hides anything else', () => {
    expect(maskCredential('${EASTUS_API_KEY}')).toEqual({ kind: 'env', name: 'EASTUS_API_KEY' });
    expect(maskCredential('sk-live-123')).toEqual({ kind: 'masked' });
    expect(maskCredential('prefix-${A}')).toEqual({ kind: 'masked' });
    expect(maskCredential(undefined)).toEqual({ kind: 'none' });
  });

  it('reads a key the server hides by its preview (azureGroupSecrets)', () => {
    expect(maskCredential(undefined, '...1234')).toEqual({ kind: 'stored', preview: '...1234' });
    expect(maskCredential(undefined, '********')).toEqual({ kind: 'masked' });
    const [row] = toAzureGroups([{ group: 'eastus', apiKeyPreview: '...1234' }]);
    expect(row).toMatchObject({ apiKey: undefined, apiKeyPreview: '...1234', others: {} });
  });
});

describe('addressIssue', () => {
  it("reports only the first problem LibreChat's schema finds", () => {
    expect(addressIssue('localhost:11434')).toBeNull();
    expect(addressIssue('[::1]:8080')).toBeNull();
    expect(addressIssue('10.0.0.5:80')).toBeNull();
    expect(addressIssue('localhost')).toBe('port');
    expect(addressIssue('http://localhost:11434')).toBe('url');
    expect(addressIssue('8.8.8.8:53')).toBe('public');
    expect(addressIssue('host:99999')).toBe('port');
    expect(addressIssue('')).toBe('empty');
  });
});

describe('providerStatus', () => {
  const endpoints = {
    openAI: { name: 'openAI', custom: false, userProvide: false },
    google: { name: 'google', custom: false, userProvide: true },
  };

  it('reads served, user-provided and missing providers', () => {
    expect(providerStatus('openAI', endpoints).kind).toBe('active');
    expect(providerStatus('google', endpoints).kind).toBe('userProvided');
    expect(providerStatus('assistants', endpoints)).toEqual({
      kind: 'disabled',
      credentialsKey: 'com_config_providers_creds_assistants',
    });
    expect(providerStatus('openAI', undefined).kind).toBe('unknown');
  });

  it('names the keys stored with Azure groups only where the panel edits them (editsAzureGroups)', () => {
    const rederive = {
      ...BUNDLED_CONFIG_FEATURES,
      endpointRederive: true,
      azureGroupMergeKey: true,
      azureGroupSecrets: true,
    };
    expect(providerStatus('azureOpenAI', endpoints, rederive).credentialsKey).toBe(
      'com_config_providers_creds_azureOpenAI_groups',
    );
    expect(
      providerStatus('azureOpenAI', endpoints, { ...rederive, endpointRederive: false })
        .credentialsKey,
    ).toBe('com_config_providers_creds_azureOpenAI');
    expect(providerStatus('azureOpenAI', endpoints).credentialsKey).toBe(
      'com_config_providers_creds_azureOpenAI',
    );
  });
});

describe('providerTocItems', () => {
  it('lists Global first, the providers in tab order, then Network access', () => {
    const fields = ['allowedAddresses', 'agents', 'all', 'openAI', 'custom'].map((key) =>
      createField({
        key,
        type: key === 'allowedAddresses' ? 'array<string>' : 'object',
        children: key === 'allowedAddresses' ? undefined : [createField({ key: 'x' })],
      }),
    );
    const items = providerTocItems(fields, 'endpoints', (key) => key);
    expect(items.map((item) => item.id)).toEqual([
      'section-endpoints.all',
      'section-endpoints.openAI',
      'section-endpoints.agents',
      'section-endpoints.allowedAddresses',
    ]);
    expect(items[3].label).toBe('com_config_providers_network_title');
  });
});
