import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  credentialKey,
  withCarriedSecrets,
  findMovedEndpointKey,
  restatableCredential,
  findRebindingWarnings,
  findDroppedCredentials,
  findDroppedEndpointKey,
  findSecretReentryIssues,
  findMovedServerCredentials,
  entryKeyMoves,
  findEntryKeyMoves,
  findUnboundOverrides,
} from './binding';
import { BUNDLED_CONFIG_FEATURES } from '@/constants';
import { planConfigChanges } from './changes';

const guarded = { recordSecrets: true, webSearchStoredKeys: true, secretRebinding: false };

const acme: t.ConfigRecord = {
  type: 'streamable-http',
  url: 'https://mcp.acme.dev/mcp',
  apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '...1234' },
};

const oauthy: t.ConfigRecord = {
  type: 'streamable-http',
  url: 'https://mcp.oauthy.dev/mcp',
  oauth: {
    authorization_url: 'https://auth.oauthy.dev/authorize',
    token_url: 'https://auth.oauthy.dev/token',
    client_id: 'cid-1',
    client_secretPreview: '...9876',
  },
};

function input(
  storedAfter: t.ConfigRecord,
  stored: t.ConfigRecord = { mcpServers: { acme, oauthy } },
  origins: ReadonlyMap<string, string> = new Map(),
  lower: t.ConfigRecord = {},
  endpointOrigins: ReadonlyMap<string, string> = new Map(),
): t.CredentialBindingInput {
  return { stored, storedAfter, lower, origins, endpointOrigins };
}

describe('findSecretReentryIssues — MCP servers (recordSecrets)', () => {
  it('asks for a stored API key again when the URL it is sent to changes', () => {
    const after = { mcpServers: { acme: { ...acme, url: 'https://evil.example/mcp' }, oauthy } };
    expect(findSecretReentryIssues(input(after), guarded)).toEqual([
      expect.objectContaining({
        path: 'mcpServers.acme.apiKey.key',
        code: 'secret_reentry_required',
        params: { fieldPaths: 'mcpServers.{}.url' },
      }),
    ]);
  });

  it('accepts the change once the key is entered again, and an unchanged destination', () => {
    const entered = {
      ...acme,
      url: 'https://evil.example/mcp',
      apiKey: { ...(acme.apiKey as t.ConfigRecord), key: 'sk-new' },
    };
    expect(findSecretReentryIssues(input({ mcpServers: { acme: entered } }), guarded)).toEqual([]);
    const sameHost = { ...acme, url: 'https://mcp.acme.dev/mcp', title: 'Acme' };
    expect(findSecretReentryIssues(input({ mcpServers: { acme: sameHost } }), guarded)).toEqual([]);
  });

  it('treats an http transport as streamable HTTP and names a changed auth header', () => {
    const http = { ...acme, type: 'http' };
    expect(findSecretReentryIssues(input({ mcpServers: { acme: http } }), guarded)).toEqual([]);
    const custom = {
      ...acme,
      apiKey: { ...(acme.apiKey as t.ConfigRecord), authorization_type: 'custom' },
    };
    const [issue] = findSecretReentryIssues(input({ mcpServers: { acme: custom } }), guarded);
    expect(issue.params?.fieldPaths).toBe(
      'mcpServers.{}.apiKey.authorization_type|mcpServers.{}.apiKey.custom_header',
    );
  });

  it('asks for an OAuth client secret again when the token URL changes, not when optional fields are left out', () => {
    const moved = {
      ...oauthy,
      oauth: { ...(oauthy.oauth as t.ConfigRecord), token_url: 'https://other.dev/token' },
    };
    expect(findSecretReentryIssues(input({ mcpServers: { oauthy: moved } }), guarded)).toEqual([
      expect.objectContaining({ path: 'mcpServers.oauthy.oauth.client_secret' }),
    ]);
    const stored = {
      mcpServers: {
        oauthy: {
          ...oauthy,
          oauth: { ...(oauthy.oauth as t.ConfigRecord), revocation_endpoint: 'https://r.dev' },
        },
      },
    };
    expect(findSecretReentryIssues(input({ mcpServers: { oauthy } }, stored), guarded)).toEqual([]);
  });

  it('compares a renamed server with the server it comes from', () => {
    const renamed = { mcpServers: { 'acme-docs': acme } };
    const origins = new Map([['acme-docs', 'acme']]);
    expect(findSecretReentryIssues(input(renamed, undefined, origins), guarded)).toEqual([]);
    const moved = { mcpServers: { 'acme-docs': { ...acme, url: 'https://x.dev/mcp' } } };
    expect(findSecretReentryIssues(input(moved, undefined, origins), guarded)).toHaveLength(1);
  });

  it('checks nothing on a server that does not guard MCP secrets', () => {
    const after = { mcpServers: { acme: { ...acme, url: 'https://evil.example/mcp' } } };
    const older = { recordSecrets: false, webSearchStoredKeys: false, secretRebinding: false };
    expect(findSecretReentryIssues(input(after), older)).toEqual([]);
  });
});

describe('withCarriedSecrets (a renames hint)', () => {
  it('fills a holder the server writes with the hidden secret of the server it comes from', () => {
    const renamed = { url: 'https://mcp.acme.dev/mcp', apiKey: { source: 'admin' }, oauth: {} };
    expect(withCarriedSecrets(renamed, acme)).toEqual({
      ...renamed,
      apiKey: { source: 'admin', keyPreview: '...1234' },
    });
    expect(withCarriedSecrets({ ...renamed, oauth: { client_id: 'c' } }, oauthy)).toEqual({
      ...renamed,
      oauth: { client_id: 'c', client_secretPreview: '...9876' },
    });
  });

  it('carries nothing into a holder the server leaves out or sets, nor a readable reference', () => {
    expect(withCarriedSecrets({ url: 'https://x.dev' }, acme)).toEqual({ url: 'https://x.dev' });
    const entered = { apiKey: { source: 'admin', key: 'sk-new' } };
    expect(withCarriedSecrets(entered, acme)).toEqual(entered);
    const reference = { apiKey: { source: 'admin', key: '${ACME_KEY}' } };
    expect(withCarriedSecrets({ apiKey: { source: 'admin' } }, reference)).toEqual({
      apiKey: { source: 'admin' },
    });
  });
});

describe('findSecretReentryIssues — web search keys (webSearchStoredKeys)', () => {
  const stored = {
    webSearch: { searxngInstanceUrl: 'https://searx.dev', searxngApiKeyPreview: '...abcd' },
  };

  it('asks for a stored key again when its URL changes or is removed', () => {
    const moved = { webSearch: { ...stored.webSearch, searxngInstanceUrl: 'https://other.dev' } };
    expect(findSecretReentryIssues(input(moved, stored), guarded)).toEqual([
      expect.objectContaining({
        path: 'webSearch.searxngApiKey',
        params: { fieldPaths: 'webSearch.searxngInstanceUrl' },
      }),
    ]);
    const removed = { webSearch: { searxngApiKeyPreview: '...abcd' } };
    expect(findSecretReentryIssues(input(removed, stored), guarded)).toHaveLength(1);
    const entered = { webSearch: { searxngInstanceUrl: 'https://other.dev', searxngApiKey: 'k' } };
    expect(findSecretReentryIssues(input(entered, stored), guarded)).toEqual([]);
  });
});

describe('findRebindingWarnings (secretRebinding)', () => {
  const rebinding = { secretRebinding: true, webSearchStoredKeys: false };
  const yaml: t.ConfigRecord = {
    mcpServers: {
      github: { type: 'http', url: 'https://api.github.dev/mcp', apiKey: { key: '${GH}' } },
    },
    endpoints: {
      custom: [{ name: 'Moonshot', apiKey: '${MOONSHOT_API_KEY}', baseURL: 'https://api.ms' }],
    },
  };

  it('warns when a layer sends an inherited key somewhere new without entering it', () => {
    const after = {
      mcpServers: { github: { url: 'https://evil.example/mcp' } },
      endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://evil.example/v1' }] },
    };
    expect(findRebindingWarnings(input(after, {}, new Map(), yaml), rebinding)).toEqual([
      { path: 'mcpServers.github.url', warning: 'secretRebinding' },
      {
        path: 'endpoints.custom',
        entryIdentity: 'Moonshot',
        warning: 'secretRebinding',
        keys: ['baseURL'],
      },
    ]);
  });

  it('does not warn when the layer enters the key, or the change was already stored', () => {
    const entered = {
      endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://e.dev', apiKey: 'sk' }] },
    };
    expect(findRebindingWarnings(input(entered, {}, new Map(), yaml), rebinding)).toEqual([]);
    const stored = { mcpServers: { github: { url: 'https://evil.example/mcp' } } };
    const after = { mcpServers: { github: { url: 'https://evil.example/mcp', timeout: 5 } } };
    expect(findRebindingWarnings(input(after, stored, new Map(), yaml), rebinding)).toEqual([]);
    expect(
      findRebindingWarnings(input(after, {}, new Map(), yaml), {
        secretRebinding: false,
        webSearchStoredKeys: false,
      }),
    ).toEqual([]);
  });

  it('asks for a credential, with no offer to send the inherited one, when it is hidden', () => {
    const hidden: t.ConfigRecord = {
      mcpServers: { acme },
      endpoints: {
        custom: [{ name: 'Vault', apiKeyPreview: '********', baseURL: 'https://api.vault' }],
      },
    };
    const after = {
      mcpServers: { acme: { url: 'https://evil.example/mcp' } },
      endpoints: { custom: [{ name: 'Vault', baseURL: 'https://evil.example/v1' }] },
    };
    expect(findRebindingWarnings(input(after, {}, new Map(), hidden), rebinding)).toEqual([
      { path: 'mcpServers.acme.url', warning: 'secretRebindingEnter' },
      {
        path: 'endpoints.custom',
        entryIdentity: 'Vault',
        warning: 'secretRebindingEnter',
        keys: ['baseURL'],
      },
    ]);
  });
});

describe('findRebindingWarnings — OCR, speech and web search keys', () => {
  const lower: t.ConfigRecord = {
    ocr: { apiKey: '${OCR_API_KEY}', baseURL: 'https://api.mistral.ai/v1' },
    speech: {
      tts: {
        elevenlabs: {
          apiKeyPreview: '...4321',
          url: 'https://api.elevenlabs.io',
          websocketUrl: 'wss://api.elevenlabs.io',
        },
      },
      stt: { openai: { apiKey: 'user_provided', url: 'https://api.openai.com/v1' } },
    },
    webSearch: {
      tavilyApiKeyPreview: '...abcd',
      tavilySearchUrl: 'https://api.tavily.com/search',
      firecrawlApiKey: '${FIRECRAWL_API_KEY}',
      firecrawlApiUrl: 'https://api.firecrawl.dev',
      jinaApiKeyPreview: '********',
    },
  };
  const both = { secretRebinding: true, webSearchStoredKeys: true };
  const warn = (path: string) => ({ path, warning: 'secretRebindingEnter' });
  const check = (
    after: t.ConfigRecord,
    features = both,
    hidden?: t.CredentialBindingInput['hidden'],
    stored: t.ConfigRecord = {},
  ) => findRebindingWarnings({ ...input(after, stored, new Map(), lower), hidden }, features);

  it('warns on each setting that moves an inherited OCR or speech key, never one each user enters', () => {
    const after = {
      ocr: { baseURL: 'https://evil.example/v1' },
      speech: {
        tts: {
          elevenlabs: { url: 'https://evil.example', websocketUrl: 'wss://evil.example' },
        },
        stt: { openai: { url: 'https://evil.example/v1' } },
      },
    };
    expect(check(after)).toEqual([
      warn('ocr.baseURL'),
      warn('speech.tts.elevenlabs.url'),
      warn('speech.tts.elevenlabs.websocketUrl'),
    ]);
    expect(check(after, { secretRebinding: false, webSearchStoredKeys: true })).toEqual([]);
  });

  it('does not warn when the key is entered, the URL is spelled the same, or the key is hidden too', () => {
    expect(check({ ocr: { baseURL: 'https://evil.example/v1', apiKey: 'sk-new' } })).toEqual([]);
    expect(check({ ocr: { baseURL: 'https://api.mistral.ai/v1#docs' } })).toEqual([]);
    expect(check({}, both, { before: [], after: ['ocr.apiKey', 'ocr.baseURL'] })).toEqual([]);
  });

  it('warns on a hidden URL beside an inherited key, and not again once that is stored', () => {
    expect(check({}, both, { before: [], after: ['ocr.baseURL'] })).toEqual([warn('ocr.baseURL')]);
    const moved = { ocr: { baseURL: 'https://evil.example/v1' } };
    expect(check({ ocr: { ...moved.ocr, model: 'm' } }, both, undefined, moved)).toEqual([]);
  });

  it('warns when a URL a stored web search key is sent to is set or hidden, whatever its value, as LibreChat withholds the key', () => {
    expect(check({ webSearch: { tavilySearchUrl: 'https://evil.example' } })).toEqual([
      warn('webSearch.tavilySearchUrl'),
    ]);
    expect(check({ webSearch: { tavilySearchUrl: 'https://api.tavily.com/search' } })).toEqual([
      warn('webSearch.tavilySearchUrl'),
    ]);
    expect(check({ webSearch: { jinaApiUrl: 'https://evil.example' } })).toEqual([
      warn('webSearch.jinaApiUrl'),
    ]);
    expect(check({}, both, { before: [], after: ['webSearch.tavilySearchUrl'] })).toEqual([
      warn('webSearch.tavilySearchUrl'),
    ]);
    expect(check({ webSearch: { tavilyExtractUrl: 'https://evil.example' } })).toEqual([
      warn('webSearch.tavilyExtractUrl'),
    ]);
  });

  it('does not warn for a web search key the target sets, a ${VAR} key, or before webSearchStoredKeys', () => {
    expect(
      check({ webSearch: { tavilySearchUrl: 'https://evil.example', tavilyApiKey: 'tvly-new' } }),
    ).toEqual([]);
    expect(check({ webSearch: { firecrawlApiUrl: 'https://evil.example' } })).toEqual([]);
    expect(
      check(
        { webSearch: { tavilySearchUrl: 'https://evil.example' } },
        { secretRebinding: true, webSearchStoredKeys: false },
      ),
    ).toEqual([]);
  });
});

describe('findDroppedCredentials (secretRebinding)', () => {
  it('lists the inherited credentials stored overrides stop LibreChat from sending', () => {
    const lower: t.ConfigRecord = {
      mcpServers: { oauthy },
      endpoints: { custom: [{ name: 'Moonshot', apiKey: '${MS}', baseURL: 'https://api.ms' }] },
    };
    const own: t.ConfigRecord = {
      mcpServers: { oauthy: { url: 'https://eu.oauthy.dev/mcp' } },
      endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://eu.ms' }] },
    };
    expect(findDroppedCredentials(own, lower)).toEqual([
      { path: 'mcpServers', entry: 'oauthy', secret: 'oauth.client_secret', moved: ['url'] },
      { path: 'endpoints.custom', entry: 'Moonshot', secret: 'apiKey', moved: ['baseURL'] },
    ]);
    expect(findDroppedEndpointKey({ apiKey: '${MS}', baseURL: 'https://a' }, undefined)).toEqual(
      [],
    );
    expect(
      findDroppedEndpointKey(
        { apiKey: '${MS}', baseURL: 'https://a' },
        { baseURL: 'https://b', apiKey: 'sk-own' },
      ),
    ).toEqual([]);
  });
});

describe('planConfigChanges — secrets moved to a new destination', () => {
  const features = { ...BUNDLED_CONFIG_FEATURES, ...guarded, secretRebinding: true };

  it('blocks a URL change that keeps a stored MCP key, until the key is entered', () => {
    const snapshot: t.WriteSnapshot = {
      stored: { mcpServers: { acme } },
      tombstones: [],
      lower: {},
      lowerKind: 'yaml',
    };
    const url: t.ConfigChange = {
      op: 'set',
      path: 'mcpServers.acme.url',
      value: 'https://evil.example/mcp',
    };
    expect(planConfigChanges([url], snapshot, features).issues).toEqual([
      expect.objectContaining({ path: 'mcpServers.acme.apiKey.key' }),
    ]);
    const key: t.ConfigChange = { op: 'set', path: 'mcpServers.acme.apiKey.key', value: 'sk-2' };
    expect(planConfigChanges([url, key], snapshot, features).issues).toEqual([]);
  });

  it('warns about a profile that moves an inherited endpoint key', () => {
    const lower = {
      endpoints: {
        custom: [
          {
            name: 'Moonshot',
            apiKey: '${MOONSHOT_API_KEY}',
            baseURL: 'https://api.ms',
            models: { default: ['kimi'] },
          },
        ],
      },
    };
    const plan = planConfigChanges(
      [
        {
          op: 'upsertEntry',
          path: 'endpoints.custom',
          key: 'Moonshot',
          identity: 'Moonshot',
          value: { name: 'Moonshot', baseURL: 'https://evil.example/v1' },
        },
      ],
      { stored: {}, tombstones: [], lower, lowerKind: 'inherited' },
      features,
    );
    expect(plan.warnings).toContainEqual({
      path: 'endpoints.custom',
      entryIdentity: 'Moonshot',
      warning: 'secretRebinding',
      keys: ['baseURL'],
    });
  });
});

describe('findSecretReentryIssues — custom endpoint, OCR and speech keys (secretRebinding)', () => {
  const rebinding = { recordSecrets: false, webSearchStoredKeys: false, secretRebinding: true };
  const acmeLLM: t.ConfigRecord = {
    name: 'AcmeLLM',
    baseURL: 'https://api.acme.dev/v1',
    models: { default: ['acme-1'] },
  };
  const stored = { endpoints: { custom: [{ ...acmeLLM, apiKeyPreview: '...7890' }] } };
  const yamlFirst = {
    endpoints: { custom: [{ name: 'ClickHouse', apiKey: '${CH_API_KEY}', baseURL: 'https://ch' }] },
  };
  const after = (entry: t.ConfigRecord) => ({ endpoints: { custom: [entry] } });

  it('asks for a stored endpoint key again when its base URL changes, naming the entry', () => {
    const moved = after({ ...acmeLLM, baseURL: 'https://api.acme-eu.dev/v1' });
    expect(findSecretReentryIssues(input(moved, stored, new Map(), yamlFirst), rebinding)).toEqual([
      {
        path: 'endpoints.custom.0.apiKey',
        code: 'secret_reentry_required',
        message: expect.any(String),
        params: { fieldPaths: 'endpoints.custom.0.baseURL' },
        entryIdentity: 'AcmeLLM',
        entryPath: 'apiKey',
      },
    ]);
  });

  it('names a provider change and the destination options of addParams and dropParams', () => {
    const moved = after({
      ...acmeLLM,
      provider: 'anthropic',
      addParams: { anthropicApiUrl: 'https://evil.dev', firstPartyEndpoint: true, top_k: 3 },
      dropParams: ['clientOptions', 'stop'],
    });
    const [issue] = findSecretReentryIssues(input(moved, stored), rebinding);
    expect(issue.params?.fieldPaths).toBe(
      'endpoints.custom.0.provider|endpoints.custom.0.addParams.anthropicApiUrl|endpoints.custom.0.dropParams',
    );
    const shaping = after({ ...acmeLLM, addParams: { top_k: 3 }, dropParams: ['stop'] });
    expect(findSecretReentryIssues(input(shaping, stored), rebinding)).toEqual([]);
  });

  it('accepts an entered key, an unchanged destination, and a rename that keeps it', () => {
    const entered = after({ ...acmeLLM, baseURL: 'https://other.dev', apiKey: 'sk-new' });
    expect(findSecretReentryIssues(input(entered, stored), rebinding)).toEqual([]);
    const fragment = after({ ...acmeLLM, baseURL: 'https://api.acme.dev/v1#eu' });
    expect(findSecretReentryIssues(input(fragment, stored), rebinding)).toEqual([]);
    const renamed = after({ ...acmeLLM, name: 'AcmeLLM2' });
    const origins = new Map([['AcmeLLM2', 'AcmeLLM']]);
    expect(
      findSecretReentryIssues(input(renamed, stored, new Map(), {}, origins), rebinding),
    ).toEqual([]);
    const movedRename = after({ ...acmeLLM, name: 'AcmeLLM2', baseURL: 'https://x.dev' });
    expect(
      findSecretReentryIssues(input(movedRename, stored, new Map(), {}, origins), rebinding),
    ).toEqual([expect.objectContaining({ entryIdentity: 'AcmeLLM2' })]);
  });

  it('asks for a stored OCR or speech key again when its URL or instance changes', () => {
    const ocr = { ocr: { baseURL: 'https://ocr.dev', apiKeyPreview: '...f123' } };
    const movedOcr = { ocr: { ...ocr.ocr, baseURL: 'https://evil.dev' } };
    expect(findSecretReentryIssues(input(movedOcr, ocr), rebinding)).toEqual([
      expect.objectContaining({ path: 'ocr.apiKey', params: { fieldPaths: 'ocr.baseURL' } }),
    ]);
    const speech = {
      speech: { tts: { azureOpenAI: { instanceName: 'east', apiKeyPreview: '...1' } } },
    };
    const movedSpeech = {
      speech: { tts: { azureOpenAI: { instanceName: 'west', apiKeyPreview: '...1' } } },
    };
    expect(findSecretReentryIssues(input(movedSpeech, speech), rebinding)).toEqual([
      expect.objectContaining({
        path: 'speech.tts.azureOpenAI.apiKey',
        params: { fieldPaths: 'speech.tts.azureOpenAI.instanceName' },
      }),
    ]);
  });

  it('checks no endpoint, OCR or speech key before secretRebinding', () => {
    const moved = after({ ...acmeLLM, baseURL: 'https://api.acme-eu.dev/v1' });
    expect(findSecretReentryIssues(input(moved, stored), guarded)).toEqual([]);
  });
});

describe('findDroppedCredentials — what LibreChat keeps sending', () => {
  const moved = { baseURL: 'https://evil.dev/v1' };

  it('keeps a key each user enters, and an endpoint that sends user values', () => {
    const template = { name: 'T', apiKey: '{{USER_KEY}}', baseURL: 'https://t.dev' };
    expect(findDroppedEndpointKey(template, moved)).toEqual([]);
    const vars = {
      name: 'C',
      apiKey: '${CF_KEY}',
      baseURL: 'https://c.dev',
      customUserVars: { TOKEN: { title: 'Token' } },
    };
    expect(findDroppedEndpointKey(vars, moved)).toEqual([]);
    const literal = { name: 'L', apiKey: '${L_KEY}', baseURL: 'https://l.dev' };
    expect(findDroppedEndpointKey(literal, moved)).toEqual(['baseURL']);
    expect(
      findDroppedEndpointKey(literal, { addParams: { anthropicApiUrl: 'https://e' } }),
    ).toEqual(['addParams.anthropicApiUrl']);
  });

  it('keeps an MCP server credential where both layers send user values: the move is set back', () => {
    const github: t.ConfigRecord = {
      type: 'http',
      url: 'https://api.github.dev/mcp',
      apiKey: { source: 'admin', authorization_type: 'bearer', key: '${GH}' },
    };
    const userVars = { customUserVars: { PAT: { title: 'PAT' } } };
    const own = { mcpServers: { github: { url: 'https://evil.dev/mcp' } } };
    expect(
      findDroppedCredentials(own, { mcpServers: { github: { ...github, ...userVars } } }),
    ).toEqual([]);
    expect(findDroppedCredentials(own, { mcpServers: { github } })).toEqual([
      { path: 'mcpServers', entry: 'github', secret: 'apiKey.key', moved: ['url'] },
    ]);
  });
});

describe('restating inherited credentials', () => {
  const moonshot = { name: 'Moonshot', apiKey: '${MS_KEY}', baseURL: 'https://api.ms' };
  const ref: t.CredentialRef = { path: 'endpoints.custom', entry: 'Moonshot', secret: 'apiKey' };

  it('offers only a readable credential LibreChat binds', () => {
    const lower = { endpoints: { custom: [moonshot] } };
    expect(restatableCredential(lower, ref)).toBe('${MS_KEY}');
    const hidden = { endpoints: { custom: [{ name: 'Moonshot', apiKeyPreview: '********' }] } };
    expect(restatableCredential(hidden, ref)).toBeUndefined();
    const user = { endpoints: { custom: [{ ...moonshot, apiKey: 'user_provided' }] } };
    expect(restatableCredential(user, ref)).toBeUndefined();
  });

  it('offers no literal a server reads back, nor a reference within other text', () => {
    const offered = (apiKey: string) =>
      restatableCredential({ endpoints: { custom: [{ ...moonshot, apiKey }] } }, ref);
    const unsafe = [
      'sk-live-0123456789abcdef',
      'Bearer ${MS_KEY}',
      '${MS_KEY}-2',
      ' ${MS_KEY}',
      '********',
      '{{MS_KEY}}',
    ];
    expect(unsafe.map(offered)).toEqual(unsafe.map(() => undefined));
    const literal = { ...moonshot, apiKey: 'sk-live-0123456789abcdef' };
    const moved = { ...literal, baseURL: 'https://evil.dev' };
    expect(findMovedEndpointKey(literal, moved, undefined, {})).toEqual({
      ...ref,
      moved: ['baseURL'],
      restatable: undefined,
      restated: false,
    });
    const github = {
      type: 'http',
      url: 'https://gh.dev/mcp',
      apiKey: { key: 'ghp_0123456789abcdef' },
    };
    const servers = findMovedServerCredentials(
      { github: { url: 'https://evil.dev/mcp' } },
      { github },
      {},
    );
    expect(servers.get('github')?.get('apiKey.key')).toMatchObject({ restatable: undefined });
  });

  it('shows a moved endpoint key, restated or kept by the stored override', () => {
    const edited = { ...moonshot, baseURL: 'https://evil.dev' };
    expect(findMovedEndpointKey(moonshot, edited, undefined, {})).toEqual({
      ...ref,
      moved: ['baseURL'],
      restatable: '${MS_KEY}',
      restated: false,
    });
    const restates = { [credentialKey(ref)]: ref };
    expect(findMovedEndpointKey(moonshot, edited, undefined, restates)?.restated).toBe(true);
    const own = { name: 'Moonshot', baseURL: 'https://evil.dev', apiKey: '${MS_KEY}' };
    expect(findMovedEndpointKey(moonshot, edited, own, {})).toBeUndefined();
    const { apiKey: _removed, ...reverted } = edited;
    expect(findMovedEndpointKey(moonshot, reverted, own, {})?.moved).toEqual(['baseURL']);
  });

  it('lists the moved credentials of each MCP server', () => {
    const lower = {
      github: { type: 'http', url: 'https://gh.dev/mcp', apiKey: { key: '${GH}' } },
    };
    const moved = findMovedServerCredentials(
      { github: { url: 'https://evil.dev/mcp' } },
      lower,
      {},
    );
    expect(moved.get('github')?.get('apiKey.key')).toEqual({
      path: 'mcpServers',
      entry: 'github',
      secret: 'apiKey.key',
      moved: ['url'],
      restatable: '${GH}',
      restated: false,
    });
  });
});

describe('planConfigChanges — restated inherited credentials (restate)', () => {
  const features = { ...BUNDLED_CONFIG_FEATURES, secretRebinding: true };
  const moonshot = {
    name: 'Moonshot',
    apiKey: '${MOONSHOT_API_KEY}',
    baseURL: 'https://api.ms',
    models: { default: ['kimi'] },
  };
  const lower = { endpoints: { custom: [moonshot] } };
  const restate: t.ConfigChange = {
    op: 'restate',
    path: 'endpoints.custom',
    entry: 'Moonshot',
    secret: 'apiKey',
  };
  const snapshot = (stored: t.ConfigRecord = {}): t.WriteSnapshot => ({
    stored,
    tombstones: [],
    lower,
    lowerKind: 'yaml',
  });
  const edit = (value: t.ConfigRecord, baseline: t.ConfigRecord = moonshot): t.ConfigChange => ({
    op: 'upsertEntry',
    path: 'endpoints.custom',
    key: 'Moonshot',
    identity: 'Moonshot',
    value,
    baseline,
  });
  const moved = { ...moonshot, baseURL: 'https://proxy.ms' };

  it('keeps the inherited key in an override that moves it, and says so', () => {
    const plan = planConfigChanges([edit(moved), restate], snapshot(), features);
    expect(plan.sets).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [{ name: 'Moonshot', baseURL: 'https://proxy.ms', apiKey: '${MOONSHOT_API_KEY}' }],
      },
    ]);
    expect(plan.warnings).toEqual([
      {
        path: 'endpoints.custom',
        entryIdentity: 'Moonshot',
        warning: 'secretRestated',
        keys: ['apiKey'],
      },
    ]);
    const unstated = planConfigChanges([edit(moved)], snapshot(), features);
    expect(unstated.warnings).toContainEqual(
      expect.objectContaining({ warning: 'secretRebinding', entryIdentity: 'Moonshot' }),
    );
  });

  it('restates a key the stored override already moves, with no other change', () => {
    const stored = { endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://proxy.ms' }] } };
    const plan = planConfigChanges([restate], snapshot(stored), features);
    expect(plan.sets).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [{ name: 'Moonshot', baseURL: 'https://proxy.ms', apiKey: '${MOONSHOT_API_KEY}' }],
      },
    ]);
    expect(plan.effective).toBe(1);
  });

  it('keeps a restated key through later edits of the entry, and drops it when the edit removes it', () => {
    const own = { name: 'Moonshot', baseURL: 'https://proxy.ms', apiKey: '${MOONSHOT_API_KEY}' };
    const stored = { endpoints: { custom: [own] } };
    const loaded = { ...moonshot, ...own };
    const models = { ...loaded, models: { default: ['kimi', 'kimi-2'] } };
    const kept = planConfigChanges([edit(models, loaded)], snapshot(stored), features);
    expect(kept.sets[0].value).toEqual([{ ...own, models: { default: ['kimi', 'kimi-2'] } }]);
    const { apiKey: _removed, ...withoutKey } = loaded;
    const dropped = planConfigChanges([edit(withoutKey, loaded)], snapshot(stored), features);
    expect(dropped.sets[0].value).toEqual([{ name: 'Moonshot', baseURL: 'https://proxy.ms' }]);
    const back = planConfigChanges([edit(moonshot, loaded)], snapshot(stored), features);
    expect(back.sets).toEqual([]);
    expect(back.resets).toEqual(['endpoints']);
  });

  it('restates nothing the plan does not move, nor before secretRebinding', () => {
    expect(planConfigChanges([restate], snapshot(), features).sets).toEqual([]);
    const older = { ...features, secretRebinding: false };
    const plan = planConfigChanges([edit(moved), restate], snapshot(), older);
    expect(plan.sets[0].value).toEqual([{ name: 'Moonshot', baseURL: 'https://proxy.ms' }]);
  });

  it('never copies a literal key into the override, with or without a restate, and asks for one', () => {
    const literal = { ...moonshot, apiKey: 'sk-live-0123456789abcdef' };
    const plain: t.WriteSnapshot = { ...snapshot(), lower: { endpoints: { custom: [literal] } } };
    const stored = { endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://proxy.ms' }] } };
    const plans = [
      planConfigChanges(
        [edit({ ...literal, baseURL: 'https://proxy.ms' }, literal), restate],
        plain,
        features,
      ),
      planConfigChanges([restate], { ...plain, stored }, features),
    ];
    expect(plans.map((plan) => plan.sets)).toEqual([
      [
        {
          fieldPath: 'endpoints.custom',
          value: [{ name: 'Moonshot', baseURL: 'https://proxy.ms' }],
        },
      ],
      [],
    ]);
    expect(plans[0].warnings).toEqual([
      expect.objectContaining({ entryIdentity: 'Moonshot', warning: 'secretRebindingEnter' }),
    ]);
    expect(JSON.stringify(plans.map(({ sets, warnings }) => ({ sets, warnings })))).not.toContain(
      'sk-live',
    );
  });

  it('copies no MCP credential but a whole ${VAR} reference', () => {
    const lower = (key: string): t.WriteSnapshot => ({
      stored: {},
      tombstones: [],
      lower: {
        mcpServers: { github: { type: 'http', url: 'https://gh.dev/mcp', apiKey: { key } } },
      },
      lowerKind: 'inherited',
    });
    const ops: t.ConfigChange[] = [
      { op: 'set', path: 'mcpServers.github.url', value: 'https://proxy.github.dev/mcp' },
      { op: 'restate', path: 'mcpServers', entry: 'github', secret: 'apiKey.key' },
    ];
    const written = (key: string) =>
      planConfigChanges(ops, lower(key), features).sets.map(({ fieldPath }) => fieldPath);
    expect(written('ghp_0123456789abcdef')).toEqual(['mcpServers.github.url']);
    expect(written('Bearer ${GH_TOKEN}')).toEqual(['mcpServers.github.url']);
    expect(written('${GH_TOKEN}')).toEqual([
      'mcpServers.github.url',
      'mcpServers.github.apiKey.key',
    ]);
  });

  it("restates an inherited MCP credential into the server's override", () => {
    const servers = {
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.github.dev/mcp',
          apiKey: { source: 'admin', authorization_type: 'bearer', key: '${GH_TOKEN}' },
        },
      },
    };
    const url: t.ConfigChange = {
      op: 'set',
      path: 'mcpServers.github.url',
      value: 'https://proxy.github.dev/mcp',
    };
    const mcp: t.ConfigChange = {
      op: 'restate',
      path: 'mcpServers',
      entry: 'github',
      secret: 'apiKey.key',
    };
    const plan = planConfigChanges(
      [url, mcp],
      { stored: {}, tombstones: [], lower: servers, lowerKind: 'inherited' },
      features,
    );
    expect(plan.sets).toEqual(
      expect.arrayContaining([
        { fieldPath: 'mcpServers.github.url', value: 'https://proxy.github.dev/mcp' },
        { fieldPath: 'mcpServers.github.apiKey.key', value: '${GH_TOKEN}' },
      ]),
    );
    expect(plan.warnings).toEqual([
      { path: 'mcpServers.github.apiKey.key', warning: 'secretRestated' },
    ]);
  });
});

describe("a profile's own keys under an entry Base moves (secretRebinding)", () => {
  const acmeLLM: t.ConfigRecord = {
    name: 'AcmeLLM',
    baseURL: 'https://api.acme.dev/v1',
    models: { default: ['acme-1'] },
    apiKeyPreview: '...7890',
  };
  const profile = (parts: Partial<t.EntryOverride>): t.EntryOverride => ({
    scope: {
      principalType: PrincipalType.ROLE,
      principalId: 'USER',
      name: 'USER',
      priority: 10,
      isActive: true,
    },
    overrides: true,
    secrets: [],
    settings: [],
    hidden: false,
    ...parts,
  });

  it('names the settings that move each MCP secret, leaving the transport out', () => {
    const moved = { ...acme, url: 'https://mcp2.acme.dev/mcp' };
    expect(entryKeyMoves('mcpServers', { lower: undefined, before: acme, after: moved })).toEqual({
      'apiKey.key': ['url'],
    });
    const header = {
      ...acme,
      apiKey: { ...(acme.apiKey as t.ConfigRecord), authorization_type: 'basic' },
    };
    expect(entryKeyMoves('mcpServers', { lower: undefined, before: acme, after: header })).toEqual({
      'apiKey.key': ['apiKey.authorization_type'],
    });
    const sse = { ...acme, type: 'sse' };
    expect(entryKeyMoves('mcpServers', { lower: undefined, before: acme, after: sse })).toEqual({});
    const token = {
      ...oauthy,
      oauth: { ...(oauthy.oauth as t.ConfigRecord), token_url: 'https://t2' },
    };
    expect(entryKeyMoves('mcpServers', { lower: undefined, before: oauthy, after: token })).toEqual(
      {
        'oauth.client_secret': ['oauth.token_url'],
      },
    );
  });

  it("names a custom endpoint's moved base URL, and none where it sends each user's own values", () => {
    const moved = { ...acmeLLM, baseURL: 'https://api2.acme.dev/v1' };
    expect(
      entryKeyMoves('endpoints.custom', { lower: undefined, before: acmeLLM, after: moved }),
    ).toEqual({ apiKey: ['baseURL'] });
    const own = { name: 'Zai', apiKey: 'user_provided', baseURL: 'https://zai' };
    expect(
      entryKeyMoves('endpoints.custom', {
        lower: own,
        before: own,
        after: { ...own, baseURL: 'https://zai2' },
      }),
    ).toEqual({});
    expect(
      entryKeyMoves('endpoints.custom', { lower: undefined, before: undefined, after: moved }),
    ).toEqual({});
  });

  it('finds the profiles whose own key a move sends elsewhere, not one that sets the moved setting itself', () => {
    const own = profile({ secrets: ['apiKey.key'], settings: ['title'] });
    const ownUrl = profile({ secrets: ['apiKey.key'], settings: ['url'] });
    const oauthOnly = profile({ secrets: ['oauth.client_secret'] });
    const noKey = profile({ settings: ['title'] });
    expect(
      findUnboundOverrides({ 'apiKey.key': ['url'] }, [own, ownUrl, oauthOnly, noKey]),
    ).toEqual([own]);
    const endpoint = profile({ secrets: ['apiKey'], settings: ['addParams'] });
    expect(findUnboundOverrides({ apiKey: ['addParams.anthropicApiUrl'] }, [endpoint])).toEqual([]);
    expect(findUnboundOverrides({ apiKey: ['baseURL'] }, [endpoint])).toEqual([endpoint]);
  });

  it("lists the entries a Base plan keeps under their names while moving their keys, by the server's flag", () => {
    const stored = { mcpServers: { acme, oauthy }, endpoints: { custom: [acmeLLM] } };
    const storedAfter = {
      mcpServers: { acme: { ...acme, url: 'https://mcp2.acme.dev/mcp' }, renamed: oauthy },
      endpoints: { custom: [{ ...acmeLLM, baseURL: 'https://api2.acme.dev/v1' }] },
    };
    const lower = { mcpServers: { kb: { type: 'sse', url: 'https://kb' } } };
    const moves = findEntryKeyMoves({ lower, stored, storedAfter }, { secretRebinding: true });
    expect(moves).toEqual([
      { collection: 'mcpServers', identity: 'acme', moves: { 'apiKey.key': ['url'] } },
      { collection: 'endpoints.custom', identity: 'AcmeLLM', moves: { apiKey: ['baseURL'] } },
    ]);
    expect(findEntryKeyMoves({ lower, stored, storedAfter }, { secretRebinding: false })).toEqual(
      [],
    );
    const reset = findEntryKeyMoves(
      { lower, stored: { mcpServers: { kb: { url: 'https://kb2' } } }, storedAfter: {} },
      { secretRebinding: true },
    );
    expect(reset).toEqual([
      { collection: 'mcpServers', identity: 'kb', moves: { 'apiKey.key': ['url'] } },
    ]);
  });
});
