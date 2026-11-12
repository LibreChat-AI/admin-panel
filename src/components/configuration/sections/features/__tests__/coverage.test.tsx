import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { CoverageFixture, HiddenFields } from '@/test/coverage';
import type * as t from '@/types';
import {
  COVERAGE_TEST_TIMEOUT_MS,
  turnOn,
  controlAt,
  typeInto,
  planWrites,
  staleHidden,
  missingLeaves,
  schemaLeaves,
  SYNTHETIC_FLAG,
  SYNTHETIC_TEXT,
  renderedAcross,
  SYNTHETIC_GROUP,
  UNKNOWN_KEY,
  findSchemaField,
  localizeEn,
  sampleValue,
  unknownSettingsAt,
  withSyntheticFields,
} from '@/test/coverage';
import { setValueAtPath, isInterfacePermissionPath } from '@/utils';
import { renderTab, PAGE_TREE, RAW_TREE } from '@/test/page';
import { labelForPath } from '@/components/configuration';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';

vi.setConfig({ testTimeout: COVERAGE_TEST_TIMEOUT_MS });

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

/** The Features tab without Langfuse, whose connection the page edits through its own API. */
const TREE = PAGE_TREE.filter((section) => section.key !== 'langfuse');
const SECTIONS = [
  'interface',
  'webSearch',
  'memory',
  'speech',
  'ocr',
  'summarization',
  'actions',
  'filteredTools',
  'includedTools',
  'messageFilter',
];

const FIXTURES: CoverageFixture[] = [
  {
    name: 'inline memory agent, token trigger, selected services',
    yaml: {
      interface: {
        skills: { defaultActiveOnShare: true },
        sharedLinks: { snapshotFiles: true },
        schedules: {
          maxPerUser: 5,
          mcpConsent: {
            resources: {
              github: {
                url: 'https://mcp.example.com',
                credentialMode: 'stored_oauth',
                issuer: 'https://issuer.example.com',
                audience: 'mcp',
                scopes: ['read'],
              },
            },
            readOnlyPolicy: {
              github: {
                tools: { list_issues: { effect: 'read_only', definitionSha256: 'a'.repeat(64) } },
              },
            },
          },
        },
      },
      webSearch: { searchProvider: 'searxng', scraperProvider: 'firecrawl', rerankerType: 'jina' },
      memory: { agent: { provider: 'openAI', model: 'gpt-4o' } },
      speech: {
        speechTab: {
          speechToText: { engineSTT: 'openai' },
          textToSpeech: { engineTTS: 'openai' },
        },
      },
      messageFilter: { pii: { customPatterns: [{ id: 'ssn', label: 'SSN', regex: '\\d+' }] } },
    },
    overrides: { summarization: { trigger: { type: 'token_ratio', value: 0.8 } } },
    open: () => fireEvent.click(screen.getByText(/Show other services/)),
  },
  {
    name: 'memory agent by id',
    yaml: { memory: { agent: { id: 'agent_123' } } },
  },
];

/** Role permissions: the server leaves them out of the editor; roles set them on the Access page. */
const PERMISSIONS: HiddenFields = Object.fromEntries(
  schemaLeaves(findSchemaField(RAW_TREE, 'interface')!)
    .filter((path) => isInterfacePermissionPath(path))
    .map((path) => [path, 'role permission, set per role on the Access page']),
);

const HIDDEN: HiddenFields = { ...PERMISSIONS };

function roots(tree: t.SchemaField[]): t.SchemaField[] {
  return SECTIONS.map((key) => {
    const root = findSchemaField(tree, key);
    if (!root) throw new Error(`no ${key} in the schema`);
    return root;
  });
}

/** A server that reports its write rules, as LibreChat lists them: the tool filters are deployment-only. */
const SERVER_RULES = createServerContract(
  {},
  {
    deploymentOnlyPaths: {
      ...BUNDLED_CONFIG_CONTRACT.rules.deploymentOnlyPaths,
      includedTools: 'operator',
      filteredTools: 'operator',
    },
  },
);

const TOOL_FILTERS: CoverageFixture = {
  name: 'tool filters librechat.yaml sets',
  yaml: { filteredTools: ['dalle'], includedTools: ['calculator'] },
};

describe('Features tab: every schema field is reachable', () => {
  it('renders every leaf of its sections, or names why not', () => {
    const shown = renderedAcross(roots(RAW_TREE), FIXTURES, (fixture) =>
      renderTab({ tab: 'features', tree: TREE, expandAll: true, ...fixture }),
    );
    const missing = roots(RAW_TREE).flatMap((root) => missingLeaves(root, shown, HIDDEN));
    expect(missing).toEqual([]);
  });

  it('names no hidden field the schema no longer has', () => {
    expect(staleHidden(roots(RAW_TREE), HIDDEN)).toEqual([]);
  });
});

describe("Features tab under a server's write rules", () => {
  const renderWithRules = (fixture: CoverageFixture) =>
    renderTab({ tab: 'features', tree: TREE, expandAll: true, contract: SERVER_RULES, ...fixture });

  it('renders every leaf of its sections, or names why not', () => {
    const shown = renderedAcross(roots(RAW_TREE), [...FIXTURES, TOOL_FILTERS], renderWithRules);
    const missing = roots(RAW_TREE).flatMap((root) => missingLeaves(root, shown, HIDDEN));
    expect(missing).toEqual([]);
  });

  it.each([
    ['filteredTools', 'dalle'],
    ['includedTools', 'calculator'],
  ])('shows %s read-only, with the value librechat.yaml sets', (path, tool) => {
    renderWithRules(TOOL_FILTERS);
    const control = controlAt(path);
    expect(control).toHaveTextContent(tool);
    expect(control.querySelector('input')).toBeNull();
  });

  it('keeps the tool filters editable on a server that does not list them', () => {
    renderTab({ tab: 'features', tree: TREE, expandAll: true, ...TOOL_FILTERS });
    expect(controlAt('filteredTools').querySelector('input')).toHaveValue('dalle');
  });
});

/** Where a newer schema could add settings: each renderer, and the objects and variants inside. */
const NEW_FIELD_PARENTS: Array<[string, string, t.ConfigRecord]> = [
  ['interface', 'interface', {}],
  ['interface.traceViewer', 'interface.traceViewer', {}],
  ['webSearch', 'webSearch', {}],
  [
    'webSearch.firecrawlOptions',
    'webSearch.firecrawlOptions',
    { webSearch: { scraperProvider: 'firecrawl' } },
  ],
  ['memory', 'memory', {}],
  ['memory.agent', 'memory.agent', { memory: { agent: { provider: 'openAI', model: 'gpt-4o' } } }],
  ['summarization', 'summarization', {}],
  ['summarization.contextPruning', 'summarization.contextPruning', {}],
  ['speech', 'speech', {}],
  ['speech.tts.elevenlabs', 'speech.tts.elevenlabs', {}],
  ['ocr', 'ocr', {}],
  ['actions', 'actions', {}],
  ['messageFilter', 'messageFilter', {}],
];

describe('Features tab: settings a newer schema adds', () => {
  it.each(NEW_FIELD_PARENTS)(
    'under %s: get a control, and an edit is saved at their path',
    (parent, dataPath, yaml) => {
      const view = renderTab({
        tab: 'features',
        tree: withSyntheticFields(TREE, parent),
        yaml,
        expandAll: true,
      });
      const text = `${dataPath}.${SYNTHETIC_TEXT}`;
      const flag = `${dataPath}.${SYNTHETIC_GROUP}.${SYNTHETIC_FLAG}`;
      typeInto(text, 'from a newer LibreChat');
      turnOn(flag);
      const plan = view.plan();
      expect(planWrites(plan, text, 'from a newer LibreChat')).toBe(true);
      expect(planWrites(plan, flag, true)).toBe(true);
    },
  );
});

describe('Features tab: keys the schema does not know', () => {
  it.each(NEW_FIELD_PARENTS)('under %s: are listed read-only', (_parent, dataPath, yaml) => {
    renderTab({
      tab: 'features',
      tree: TREE,
      yaml: setValueAtPath(yaml, `${dataPath}.${UNKNOWN_KEY}`, 'kept as is'),
      expandAll: true,
    });
    const list = unknownSettingsAt(dataPath);
    expect(list).not.toBeNull();
    expect(list).toHaveTextContent(UNKNOWN_KEY);
    expect(list).toHaveTextContent('kept as is');
  });
});

/** A content filter surface's card in the read-only summary, by its title. */
function surfaceCard(title: string): HTMLElement {
  const card = within(screen.getByRole('list', { name: 'Filtered content' }))
    .getAllByRole('listitem')
    .find((item) => item.firstElementChild?.textContent?.startsWith(title));
  if (!card) throw new Error(`no summary card for ${title}`);
  return card;
}

/** Keys of `pii` the summary states in rows of its own (the action badge, Scans and Patterns). */
const PII_ROWS = /\.pii\.(action|fields|starterPatterns|customPatterns)(\.|$)/;

describe('Content filters (read-only summary of librechat.yaml)', () => {
  const filters = findSchemaField(RAW_TREE, 'filters')!;

  it('lists every setting librechat.yaml sets, on the card of its surface', () => {
    renderTab({ tab: 'features', tree: TREE, yaml: { filters: sampleValue(filters) } });
    const missing = (filters.children ?? []).flatMap((surface) => {
      const card = surfaceCard(labelForPath(surface.path, localizeEn));
      return schemaLeaves(surface).filter((leaf) => {
        if (PII_ROWS.test(leaf)) return within(card).queryByText('Block') == null;
        return !card.textContent?.includes(labelForPath(leaf, localizeEn));
      });
    });
    expect(missing).toEqual([]);
  });

  it.each(['filters.messages', 'filters.messages.pii'])(
    'shows what a newer schema adds under %s',
    (parent) => {
      const added = { [SYNTHETIC_TEXT]: 'redact', [SYNTHETIC_GROUP]: { [SYNTHETIC_FLAG]: true } };
      const yaml = setValueAtPath({ filters: { messages: { pii: { action: 'block' } } } }, parent, {
        ...(parent.endsWith('.pii') && { action: 'block' }),
        ...added,
      });
      renderTab({ tab: 'features', tree: withSyntheticFields(TREE, parent), yaml });
      const card = surfaceCard('Messages');
      expect(card).toHaveTextContent(`${SYNTHETIC_TEXT}redact`);
      expect(card).toHaveTextContent(`${SYNTHETIC_GROUP} › ${SYNTHETIC_FLAG}On`);
    },
  );

  it('lists keys the schema does not know, read-only', () => {
    renderTab({
      tab: 'features',
      tree: TREE,
      yaml: {
        filters: {
          [UNKNOWN_KEY]: 'kept',
          messages: { pii: { action: 'block' }, [UNKNOWN_KEY]: 'on the surface' },
        },
      },
    });
    expect(unknownSettingsAt('filters')).toHaveTextContent(UNKNOWN_KEY);
    expect(surfaceCard('Messages')).toHaveTextContent(`${UNKNOWN_KEY}on the surface`);
  });
});
