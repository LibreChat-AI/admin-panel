import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { createField, createServerContract } from '@/test/fixtures';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { FieldControl } from '../../renderer/FieldControl';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { EnvStatusNote } from '../EnvStatus';

const ENV_STATUS = createServerContract({ envStatus: true });
const ALLOWLIST = createServerContract({ envStatus: true, envAllowlist: true });

/** `GET /env-status` as `toEnvStatusMap` reads it. */
const STATUS: t.EnvStatusMap = {
  CH_API_KEY: { set: true, userProvided: false, sources: ['yaml'] },
  CF_ACCOUNT_ID: { set: true, userProvided: false, sources: ['yaml'] },
  CF_GATEWAY_ID: { set: false, userProvided: false, sources: ['yaml'] },
  GROQ_API_KEY: { set: true, userProvided: true, sources: ['yaml'] },
  PROFILE_TOKEN: { set: true, userProvided: false, sources: ['override'] },
  EXTRA_TOKEN: { set: true, userProvided: false, sources: ['allowlist', 'override'] },
  SERPER_API_KEY: { set: true, userProvided: false, sources: ['default', 'override'] },
};

function seededClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(['envStatus'], STATUS);
  return client;
}

function wrap(
  children: ReactNode,
  contract: t.ConfigContract = ENV_STATUS,
  client = seededClient(),
) {
  return (
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>
    </QueryClientProvider>
  );
}

const textField = createField({ key: 'baseURL', path: 'endpoints.custom.baseURL' });
const headersField = createField({
  key: 'headers',
  path: 'endpoints.custom.headers',
  type: 'record',
  isObject: true,
});

function control(props: Partial<t.FieldControlProps>): t.FieldControlProps {
  return {
    field: textField,
    path: 'endpoints.custom.0.baseURL',
    id: 'field',
    label: 'Base URL',
    value: undefined,
    onChange: vi.fn(),
    onClear: vi.fn(),
    fieldDefault: { hasOwnValue: true, value: undefined, source: 'default' },
    ...props,
  };
}

function states(): Array<[string, string | null]> {
  return Array.from(document.querySelectorAll('[data-env-state]'), (item) => [
    item.textContent ?? '',
    item.getAttribute('data-env-state'),
  ]);
}

describe('FieldControl env status (envStatus)', () => {
  it('says whether each env name a value references is set on the server', () => {
    render(
      wrap(
        <FieldControl
          {...control({ value: 'https://gateway/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/${NEW_KEY}' })}
        />,
      ),
    );
    expect(screen.getByRole('list', { name: 'Environment variables on the server' })).toBeVisible();
    expect(states()).toEqual([
      ['CF_ACCOUNT_ID is set on the server.', 'set'],
      ['CF_GATEWAY_ID is not set on the server, so it resolves to nothing.', 'unset'],
      ['NEW_KEY is not reported by the server.', 'unreported'],
    ]);
  });

  it('reports the references of a header map, and a user-provided value', () => {
    render(
      wrap(
        <FieldControl
          {...control({
            field: headersField,
            path: 'endpoints.custom.0.headers',
            value: { Authorization: 'Bearer ${GROQ_API_KEY}', 'X-Team': '{{TEAM}}' },
          })}
        />,
      ),
    );
    expect(states()).toEqual([
      ['GROQ_API_KEY is user_provided: each user enters their own.', 'userProvided'],
    ]);
  });

  it('reports the value a field shows from the layer beneath while it has none of its own', () => {
    render(
      wrap(
        <FieldControl
          {...control({
            value: undefined,
            fieldDefault: { hasOwnValue: false, value: '${CH_API_KEY}', source: 'yaml' },
          })}
        />,
      ),
    );
    expect(states()).toEqual([['CH_API_KEY is set on the server.', 'set']]);
  });

  it('says a name only stored profiles use resolves to nothing where the server applies its allowlist', () => {
    const value = 'Bearer ${PROFILE_TOKEN} ${EXTRA_TOKEN} ${SERPER_API_KEY}';
    const policed = render(
      wrap(
        <FieldControl
          {...control({
            field: headersField,
            path: 'endpoints.custom.0.headers',
            value: { Authorization: value },
          })}
        />,
        ALLOWLIST,
      ),
    );
    expect(states()).toEqual([
      [
        "PROFILE_TOKEN is not in the server's allowlist for overrides, so it resolves to nothing.",
        'notAllowed',
      ],
      ['EXTRA_TOKEN is set on the server.', 'set'],
      [
        "SERPER_API_KEY is not in the server's allowlist for overrides, so it resolves to nothing.",
        'notAllowed',
      ],
    ]);
    policed.unmount();
    render(
      wrap(
        <FieldControl
          {...control({
            field: headersField,
            path: 'endpoints.custom.0.headers',
            value: { Authorization: value },
          })}
        />,
      ),
    );
    expect(states().map(([, state]) => state)).toEqual(['set', 'set', 'set']);
  });

  it('allows a name loading fills in at the field it fills, and shows the name as code', () => {
    render(
      wrap(
        <FieldControl
          {...control({
            field: createField({ key: 'serperApiKey', path: 'webSearch.serperApiKey' }),
            path: 'webSearch.serperApiKey',
            value: '${SERPER_API_KEY}',
          })}
        />,
        ALLOWLIST,
      ),
    );
    expect(states()).toEqual([['SERPER_API_KEY is set on the server.', 'set']]);
    expect(document.querySelector('[data-env-state] code')).toHaveTextContent('SERPER_API_KEY');
  });

  it('reports nothing for a stored secret, a value without references, or an older server', () => {
    const secret = render(
      wrap(
        <FieldControl
          {...control({
            value: '',
            secretPreview: 'sk-...abcd',
            onCancelSecret: vi.fn(),
            fieldDefault: { hasOwnValue: false, value: '${CH_API_KEY}', source: 'yaml' },
          })}
        />,
      ),
    );
    expect(states()).toEqual([]);
    secret.unmount();
    const plain = render(wrap(<FieldControl {...control({ value: 'https://api.x.ai/v1' })} />));
    expect(states()).toEqual([]);
    plain.unmount();
  });

  it.each([
    ['without a meta route', BUNDLED_CONFIG_CONTRACT],
    ['whose meta leaves envStatus out', createServerContract({ envAllowlist: true })],
  ])('reports nothing on a server %s, and reads no status', (_label, contract) => {
    const client = seededClient();
    render(wrap(<FieldControl {...control({ value: '${CH_API_KEY}' })} />, contract, client));
    expect(states()).toEqual([]);
    expect(screen.getByRole('textbox')).toBeVisible();
    expect(client.getQueryState(['envStatus'])?.fetchStatus).toBe('idle');
    expect(
      client
        .getQueryCache()
        .find({ queryKey: ['envStatus'] })
        ?.isActive(),
    ).toBe(false);
  });

  it.each([
    ['interface copy', 'interface.customWelcome'],
    ['a model spec', 'modelSpecs.list.0.preset.promptPrefix'],
    ['a custom endpoint title prompt', 'endpoints.custom.0.titlePrompt'],
    ['a built-in endpoint activity prompt', 'endpoints.anthropic.activityPrompt'],
    ['a summarization prompt', 'summarization.prompt'],
    ['the memory agent instructions', 'memory.agent.instructions'],
  ])('reports nothing for %s, where LibreChat expands no reference', (_label, path) => {
    render(wrap(<FieldControl {...control({ path, value: 'Hi ${CH_API_KEY}' })} />));
    expect(states()).toEqual([]);
  });

  it('reports nothing for the templates an Azure group base URL fills in', () => {
    render(
      wrap(
        <FieldControl
          {...control({
            path: 'endpoints.azureOpenAI.groups.0.baseURL',
            value: 'https://${INSTANCE_NAME}.openai.azure.com/${DEPLOYMENT_NAME}',
          })}
        />,
      ),
    );
    expect(states()).toEqual([]);
  });

  it('reports nothing while the status loads', () => {
    const client = new QueryClient();
    client.setQueryDefaults(['envStatus'], {
      queryFn: () => new Promise<t.EnvStatusMap>(() => {}),
    });
    render(wrap(<FieldControl {...control({ value: '${CH_API_KEY}' })} />, ENV_STATUS, client));
    expect(states()).toEqual([]);
    expect(screen.getByRole('textbox')).toBeVisible();
  });
});

describe('EnvStatusNote', () => {
  it("names a setting's env names, an unset optional one neutrally", () => {
    render(wrap(<EnvStatusNote names={['CH_API_KEY', 'CF_GATEWAY_ID']} optional />));
    expect(states()).toEqual([
      ['CH_API_KEY is set on the server.', 'set'],
      ['CF_GATEWAY_ID is not set on the server.', 'unset'],
    ]);
  });
});
