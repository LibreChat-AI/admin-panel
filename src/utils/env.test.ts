import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  isLiteralTextPath,
  envReferenceState,
  readEnvReferences,
  collectEnvReferences,
} from './env';

const namesOf = (references: t.EnvReferenceSites): string[] => [...references.keys()];

describe('collectEnvReferences', () => {
  it('finds every ${NAME} in a string, once each, in order of first use, with where it is', () => {
    const references = collectEnvReferences(
      'https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/x/${CF_ACCOUNT_ID}',
      'endpoints.custom.0.baseURL',
    );
    expect(namesOf(references)).toEqual(['CF_ACCOUNT_ID', 'CF_GATEWAY_ID']);
    expect(references.get('CF_GATEWAY_ID')).toEqual(['endpoints.custom.0.baseURL']);
  });

  it('looks inside objects and lists, such as header maps', () => {
    const references = collectEnvReferences(
      {
        headers: { Authorization: 'Bearer ${GH_TOKEN}', 'X-Team': '{{TEAM}}' },
        args: ['--key', '${CLI_KEY}'],
        timeout: 30,
        enabled: true,
        nothing: null,
      },
      'mcpServers.github',
    );
    expect(namesOf(references)).toEqual(['GH_TOKEN', 'CLI_KEY']);
    expect(references.get('GH_TOKEN')).toEqual(['mcpServers.github.headers.Authorization']);
    expect(references.get('CLI_KEY')).toEqual(['mcpServers.github.args.1']);
  });

  it('finds nothing in values without references, and collects across calls', () => {
    expect(collectEnvReferences('sk-live').size).toBe(0);
    expect(collectEnvReferences(undefined).size).toBe(0);
    expect(collectEnvReferences('$NOT_A_REFERENCE').size).toBe(0);
    const into = collectEnvReferences('${A}', 'ocr.apiKey');
    collectEnvReferences(['${B}', '${A}'], 'mcpServers.x.args', into);
    expect(namesOf(into)).toEqual(['A', 'B']);
    expect(into.get('A')).toEqual(['ocr.apiKey', 'mcpServers.x.args.1']);
  });

  it('skips text LibreChat shows or sends as written, as it skips it', () => {
    expect(collectEnvReferences('Hi ${CH_API_KEY}', 'interface.customWelcome').size).toBe(0);
    expect(collectEnvReferences({ list: [{ label: '${A}' }] }, 'modelSpecs').size).toBe(0);
    expect(collectEnvReferences('Title ${A}', 'endpoints.custom.0.titlePrompt').size).toBe(0);
    expect(collectEnvReferences('Title ${A}', 'endpoints.anthropic.titlePrompt').size).toBe(0);
    expect(collectEnvReferences('${A}', 'summarization.updatePrompt').size).toBe(0);
    expect(collectEnvReferences('${A}', 'memory.agent.instructions').size).toBe(0);
    expect(
      collectEnvReferences(
        { prompt: '${A}', schema: '${B}' },
        'webSearch.firecrawlOptions.changeTrackingOptions',
      ),
    ).toEqual(new Map([['B', ['webSearch.firecrawlOptions.changeTrackingOptions.schema']]]));
    expect(
      collectEnvReferences(
        { titlePrompt: '${A}', headers: { 'X-Prompt': '${B}' } },
        'endpoints.custom.0',
      ),
    ).toEqual(new Map([['B', ['endpoints.custom.0.headers.X-Prompt']]]));
    expect(
      collectEnvReferences({ interface: { customWelcome: '${A}' }, ocr: { apiKey: '${B}' } }),
    ).toEqual(new Map([['B', ['ocr.apiKey']]]));
  });

  it('skips the templates the Azure client fills in a group base URL, and nothing else there', () => {
    const references = collectEnvReferences(
      'https://${INSTANCE_NAME}.openai.azure.com/openai/deployments/${DEPLOYMENT_NAME}?key=${AZ_KEY}',
      'endpoints.azureOpenAI.groups.0.baseURL',
    );
    expect(namesOf(references)).toEqual(['AZ_KEY']);
    expect(namesOf(collectEnvReferences('${INSTANCE_NAME}', 'endpoints.custom.0.baseURL'))).toEqual(
      ['INSTANCE_NAME'],
    );
  });
});

describe('isLiteralTextPath', () => {
  it('matches the literal sections and exactly the literal prompt fields', () => {
    expect(isLiteralTextPath(['interface', 'customWelcome'])).toBe(true);
    expect(isLiteralTextPath(['endpoints', 'custom', 'Ollama', 'activityPrompt'])).toBe(true);
    expect(isLiteralTextPath(['endpoints', 'all', 'reasoningLabelPrompt'])).toBe(true);
    expect(isLiteralTextPath(['endpoints', 'custom', '0', 'headers', 'titlePrompt'])).toBe(false);
    expect(isLiteralTextPath(['memory', 'instructions'])).toBe(false);
    expect(isLiteralTextPath([])).toBe(false);
  });
});

describe('readEnvReferences', () => {
  const status: t.EnvStatusMap = {
    SET: { set: true, userProvided: false, sources: ['yaml'] },
    EMPTY: { set: false, userProvided: false, sources: ['default'] },
    USERS: { set: true, userProvided: true, sources: ['yaml'] },
    PROFILE_ONLY: { set: true, userProvided: false, sources: ['override'] },
    ALLOWLISTED: { set: true, userProvided: false, sources: ['allowlist', 'override'] },
    ENDPOINT: { set: true, userProvided: false, sources: ['endpoint', 'override'] },
    SERPER_API_KEY: { set: true, userProvided: false, sources: ['default', 'override'] },
    UNSOURCED: { set: true, userProvided: false, sources: [] },
  };
  const at = (entries: Array<[string, string[]]>): t.EnvReferenceSites => new Map(entries);

  it('reads each name as set, unset, user-provided or not reported', () => {
    const references = at([
      ['SET', ['']],
      ['EMPTY', ['']],
      ['USERS', ['']],
      ['MISSING', ['']],
    ]);
    expect(readEnvReferences(references, status, false)).toEqual([
      { name: 'SET', state: 'set' },
      { name: 'EMPTY', state: 'unset' },
      { name: 'USERS', state: 'userProvided' },
      { name: 'MISSING', state: 'unreported' },
    ]);
  });

  it('reads a name only stored profiles use as not allowed where the server applies its allowlist', () => {
    const references = at([
      ['PROFILE_ONLY', ['endpoints.custom.0.apiKey']],
      ['ALLOWLISTED', ['endpoints.custom.0.apiKey']],
      ['ENDPOINT', ['endpoints.custom.0.apiKey']],
      ['UNSOURCED', ['endpoints.custom.0.apiKey']],
    ]);
    expect(readEnvReferences(references, status, true)).toEqual([
      { name: 'PROFILE_ONLY', state: 'notAllowed' },
      { name: 'ALLOWLISTED', state: 'set' },
      { name: 'ENDPOINT', state: 'set' },
      { name: 'UNSOURCED', state: 'set' },
    ]);
    expect(readEnvReferences(references, status, false)[0]).toEqual({
      name: 'PROFILE_ONLY',
      state: 'set',
    });
  });

  it('allows a name only loading fills in where it fills it in, and nowhere else', () => {
    const serper = status.SERPER_API_KEY;
    expect(envReferenceState('SERPER_API_KEY', serper, ['webSearch.serperApiKey'], true)).toBe(
      'set',
    );
    expect(envReferenceState('SERPER_API_KEY', serper, ['endpoints.custom.0.apiKey'], true)).toBe(
      'notAllowed',
    );
    expect(
      envReferenceState(
        'SERPER_API_KEY',
        serper,
        ['webSearch.serperApiKey', 'mcpServers.x.headers.Authorization'],
        true,
      ),
    ).toBe('notAllowed');
    expect(envReferenceState('SERPER_API_KEY', serper, [''], true)).toBe('set');
  });

  it('reads a missing status as not reported, allowlist or not', () => {
    expect(envReferenceState('MISSING', undefined)).toBe('unreported');
    expect(envReferenceState('MISSING', undefined, ['ocr.apiKey'], true)).toBe('unreported');
  });
});
