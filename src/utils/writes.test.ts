import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { BUNDLED_CONFIG_FEATURES, getWriteRules } from '@/constants';
import { reportedPath, readWriteReport, readBatchReport, getWriteSkipReason } from './writes';
import { createServerContract } from '@/test/fixtures';
import { entryLocation } from './collections';
import { createPathIndex } from './paths';

const REPORT: t.PatchFieldsResponse = {
  config: { overrides: { interface: { modelSelect: true } } },
  applied: [{ path: 'interface', segments: ['interface'] }],
  skipped: [
    {
      path: 'interface.prompts',
      segments: ['interface', 'prompts'],
      reason: 'interface_permission',
    },
    { path: 'rateLimits', segments: ['rateLimits'], reason: 'deployment_only_path' },
    {
      path: 'endpoints.agents.pullRequests.provider',
      segments: ['endpoints', 'agents', 'pullRequests', 'provider'],
      reason: 'base_only_path',
    },
    { path: 'mcpServers.linear', segments: ['mcpServers', 'linear'], reason: 'process_mcp_server' },
    { path: 'futureSection', segments: ['futureSection'], reason: 'some_future_reason' },
  ],
  ignored: [
    {
      path: 'endpoints.custom.Moonshot.apiKey',
      segments: ['endpoints', 'custom', 'Moonshot', 'apiKey'],
      reason: 'secret_rebinding',
    },
  ],
};

describe('readWriteReport', () => {
  it('reads nothing from a server without a write report or credential rebinding', () => {
    expect(readWriteReport(REPORT, BUNDLED_CONFIG_FEATURES)).toEqual([]);
  });

  it("words each location the server did not store, and each it leaves out, by the panel's reasons", () => {
    const features = { ...BUNDLED_CONFIG_FEATURES, writeReport: true };
    expect(readWriteReport(REPORT, features)).toEqual([
      { fieldPath: 'interface.prompts', reason: 'permission' },
      { fieldPath: 'rateLimits', reason: 'yamlOnly' },
      { fieldPath: 'endpoints.agents.pullRequests.provider', reason: 'baseOnly' },
      { fieldPath: 'mcpServers.linear', reason: 'processServer' },
      { fieldPath: 'futureSection', reason: 'notStored' },
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
  });

  it('reads only the dropped credentials on a server that rebinds them without a write report', () => {
    const features = { ...BUNDLED_CONFIG_FEATURES, secretRebinding: true };
    expect(readWriteReport(REPORT, features)).toEqual([
      { fieldPath: 'endpoints.custom.Moonshot.apiKey', reason: 'secretRebinding' },
    ]);
  });

  describe('a dropped credential, for the changes a save made', () => {
    const features = { ...BUNDLED_CONFIG_FEATURES, secretRebinding: true };
    const dropped = (path: string, segments = path.split('.')) => ({
      path,
      segments,
      reason: 'secret_rebinding',
    });
    const body: t.PatchFieldsResponse = {
      ignored: [
        dropped('endpoints.custom.Moonshot.apiKey'),
        dropped('endpoints.custom.ollama.apiKey'),
        dropped('endpoints.custom.Proxy.Two.apiKey', [
          'endpoints',
          'custom',
          'Proxy.Two',
          'apiKey',
        ]),
        dropped('mcpServers.github.apiKey.key'),
        dropped('mcpServers.linear.oauth.client_secret'),
        dropped('endpoints.azureOpenAI.groupMap.eastus.apiKey'),
        dropped('ocr.apiKey'),
        dropped('speech.tts.openai.apiKey'),
      ],
    };
    const shownFor = (changed: string[]) =>
      readWriteReport(body, features, createPathIndex(changed)).map(({ fieldPath }) => fieldPath);

    it('is shown when the save changed its entry or the object holding it', () => {
      expect(shownFor(['endpoints.custom.Moonshot'])).toEqual(['endpoints.custom.Moonshot.apiKey']);
      expect(shownFor(['mcpServers.github.url'])).toEqual(['mcpServers.github.apiKey.key']);
      expect(shownFor(['mcpServers.linear'])).toEqual(['mcpServers.linear.oauth.client_secret']);
      expect(shownFor(['ocr.baseURL'])).toEqual(['ocr.apiKey']);
      expect(shownFor(['speech.tts.openai.url'])).toEqual(['speech.tts.openai.apiKey']);
    });

    it('matches an entry by its served name, a dotted name whole, and Azure groups by their list', () => {
      expect(shownFor([entryLocation('endpoints.custom', 'Ollama')])).toEqual([
        'endpoints.custom.ollama.apiKey',
      ]);
      expect(shownFor(['endpoints.custom.Proxy.Two'])).toEqual(['endpoints.custom']);
      expect(shownFor(['endpoints.azureOpenAI.groups'])).toEqual([
        'endpoints.azureOpenAI.groupMap.eastus.apiKey',
      ]);
    });

    it('is shown for a whole section the save wrote', () => {
      expect(shownFor(['mcpServers'])).toEqual([
        'mcpServers.github.apiKey.key',
        'mcpServers.linear.oauth.client_secret',
      ]);
    });

    it('is not repeated by a save elsewhere, even in the same section or record', () => {
      expect(shownFor(['balance.startBalance'])).toEqual([]);
      expect(shownFor(['endpoints.openAI.titleModel', 'endpoints.custom.GPT'])).toEqual([]);
      expect(shownFor(['mcpServers.cloudflare.url', 'speech.tts.elevenlabs.url'])).toEqual([]);
      expect(shownFor(['endpoints.azureOpenAI.titleModel', 'speech.stt.openai.url'])).toEqual([]);
    });
  });

  it('ignores a reply without the lists, and a location it cannot name', () => {
    const features = { ...BUNDLED_CONFIG_FEATURES, writeReport: true };
    expect(readWriteReport({ config: null }, features)).toEqual([]);
    expect(readWriteReport({ skipped: [{ reason: 'base_only_path' }] }, features)).toEqual([]);
  });
});

describe('readBatchReport', () => {
  it('reads what a change batch skipped and what the merge ignores, whatever the flags', () => {
    const body: t.PatchFieldsResponse = {
      skipped: [
        { opIndex: 0, segments: ['turnstile'], reason: 'base_only_section' },
        { opIndex: 1, segments: ['interface', 'prompts'], reason: 'interface_permission' },
      ],
      ignored: [
        { opIndex: 2, segments: ['mcpServers', 'everything'], reason: 'process_mcp_server' },
        {
          path: 'webSearch.jinaApiKey',
          segments: ['webSearch', 'jinaApiKey'],
          reason: 'secret_rebinding',
        },
      ],
    };
    const changed = createPathIndex(['turnstile', 'interface', 'mcpServers.everything']);
    expect(readBatchReport(body, changed)).toEqual([
      { fieldPath: 'turnstile', reason: 'baseOnly' },
      { fieldPath: 'interface.prompts', reason: 'permission' },
      { fieldPath: 'mcpServers.everything', reason: 'processServer' },
    ]);
  });

  describe('for the locations the save changed', () => {
    const rebinding = (segments: string[]): t.ReportedSkip => ({
      path: segments.join('.'),
      segments,
      reason: 'secret_rebinding',
    });
    const body: t.PatchFieldsResponse = {
      skipped: [
        { opIndex: 0, segments: ['endpoints', 'custom'], reason: 'base_only_path' },
        {
          opIndex: 1,
          segments: ['endpoints', 'custom', 'GPT', 'headers'],
          reason: 'base_only_path',
        },
        {
          opIndex: 1,
          segments: ['endpoints', 'custom', 'Moonshot', 'headers'],
          reason: 'base_only_path',
        },
      ],
      ignored: [
        { opIndex: 2, segments: ['mcpServers', 'everything'], reason: 'process_mcp_server' },
        rebinding(['endpoints', 'custom', 'Moonshot', 'apiKey']),
        rebinding(['mcpServers', 'github', 'apiKey', 'key']),
        rebinding(['ocr', 'apiKey']),
      ],
    };
    const shownFor = (changed: string[]) =>
      readBatchReport(body, createPathIndex(changed)).map(({ fieldPath }) => fieldPath);

    it('keeps a dropped credential only when the save changed its entry or the object holding it', () => {
      expect(shownFor(['endpoints.custom.Moonshot'])).toEqual([
        'endpoints.custom',
        'endpoints.custom.Moonshot.headers',
        'endpoints.custom.Moonshot.apiKey',
      ]);
      expect(shownFor(['mcpServers.github.url'])).toEqual(['mcpServers.github.apiKey.key']);
      expect(shownFor(['ocr.baseURL'])).toEqual(['ocr.apiKey']);
    });

    it('does not repeat a dropped credential or a part of another entry for a save elsewhere', () => {
      expect(shownFor(['balance.startBalance'])).toEqual([]);
      expect(shownFor(['endpoints.custom.GPT'])).toEqual([
        'endpoints.custom',
        'endpoints.custom.GPT.headers',
      ]);
      expect(shownFor(['mcpServers.cloudflare.url', 'speech.tts.openai.url'])).toEqual([]);
    });

    it('keeps a part reported under a server the save changed, whatever its reason', () => {
      expect(shownFor(['mcpServers.everything.url'])).toEqual(['mcpServers.everything']);
    });
  });
});

describe('reportedPath', () => {
  it('names a dotted record key by its record, and a location by its segments', () => {
    expect(
      reportedPath({
        path: 'endpoints.bedrock.inferenceProfiles.us.anthropic.claude-sonnet-4-6',
        segments: ['endpoints', 'bedrock', 'inferenceProfiles', 'us.anthropic.claude-sonnet-4-6'],
      }),
    ).toBe('endpoints.bedrock.inferenceProfiles');
    expect(reportedPath({ segments: ['mcpServers', 'docs', 'url'] })).toBe('mcpServers.docs.url');
    expect(reportedPath({ path: 'balance.startBalance' })).toBe('balance.startBalance');
    expect(reportedPath({ segments: ['a.b'] })).toBe('a.b');
  });
});

describe('getWriteSkipReason', () => {
  const rules = getWriteRules(
    createServerContract(
      { preAuthBaseOverrides: true },
      {
        baseOnlySections: ['filters', 'turnstile'],
        baseOnlyPaths: ['endpoints.agents.pullRequests.provider'],
        deploymentOnlyPaths: {
          includedTools: 'operator',
          'endpoints.agents.eventDriven': 'startup',
        },
      },
    ),
  );

  it("follows the server's rules: what it reads only from librechat.yaml, and what Base may now set", () => {
    expect(getWriteSkipReason('registration.socialLogins', false)).toBe('yamlOnly');
    expect(getWriteSkipReason('registration.socialLogins', false, rules)).toBeNull();
    expect(getWriteSkipReason('includedTools', false, rules)).toBe('yamlOnly');
    expect(getWriteSkipReason('includedTools', true, rules)).toBeNull();
    expect(getWriteSkipReason('endpoints.agents.pullRequests.provider', false, rules)).toBe(
      'yamlOnly',
    );
    expect(getWriteSkipReason('endpoints.agents.eventDriven', false, rules)).toBe('yamlOnly');
    expect(getWriteSkipReason('filters.pii', true, rules)).toBe('baseOnly');
    expect(getWriteSkipReason('rateLimits.fileUploads.ipMax', false, rules)).toBeNull();
    expect(getWriteSkipReason('rateLimits.fileUploads.ipMax', false)).toBe('yamlOnly');
  });
});
