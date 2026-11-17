import '@/locales/i18n';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  BASE_ONLY_CONFIG_PATHS,
  BASE_ONLY_CONFIG_SECTIONS,
  DEPLOYMENT_ONLY_CONFIG_PATHS,
} from 'librechat-data-provider';
import type * as t from '@/types';
import { createServerContract } from '@/test/fixtures';
import { renderSections } from '@/test/sections';

/** The paths LibreChat#17820 added to `DEPLOYMENT_ONLY_CONFIG_PATHS` (data-provider 0.8.531). */
const LISTED_SINCE_17820: ReadonlySet<string> = new Set([
  'telemetry.rum',
  'clientLimits',
  'conversationList',
  'passwordHashing',
  'interface.colorModeFromUrl',
  'fileConfig.skills.deletionCleanupConcurrency',
  'endpoints.agents.managementApi',
]);

function serverListing(
  deploymentOnlyPaths: t.ConfigRules['deploymentOnlyPaths'],
): t.ConfigContract {
  return createServerContract(
    {},
    {
      baseOnlySections: [...BASE_ONLY_CONFIG_SECTIONS],
      baseOnlyPaths: [...BASE_ONLY_CONFIG_PATHS],
      deploymentOnlyPaths,
    },
  );
}

/** A server reporting the bundled data-provider's own lists, which name these settings. */
const CURRENT = serverListing({ ...DEPLOYMENT_ONLY_CONFIG_PATHS });

/** A server that reports its rules from before LibreChat#17820, which leave these settings out. */
const BEFORE_17820 = serverListing(
  Object.fromEntries(
    Object.entries(DEPLOYMENT_ONLY_CONFIG_PATHS).filter(([path]) => !LISTED_SINCE_17820.has(path)),
  ),
);

const SERVERS: ReadonlyArray<[string, t.ConfigContract]> = [
  ['a server that reports its rules from before LibreChat#17820', BEFORE_17820],
  ['a server that lists them', CURRENT],
];

/** Each section LibreChat reads from librechat.yaml alone, a value it sets, that field, and why it is read-only. */
const SECTIONS: ReadonlyArray<[string, t.ConfigRecord, string, RegExp]> = [
  ['clientLimits', { refreshMs: 20_000 }, 'refreshMs', /sends these limits to the browser/],
  [
    'telemetry',
    { stackTraceLimit: 20, rum: { enabled: true } },
    'stackTraceLimit',
    /real user monitoring and the server's error stack depth/,
  ],
  ['conversationList', { maxEndpointFilters: 4 }, 'maxEndpointFilters', /filter limits/],
  ['passwordHashing', { maxWorkers: 2 }, 'maxWorkers', /hashing workers .* when it starts/],
];

/** Sections only a server that lists them as deployment-only knows: LibreChat 0.8.531's. */
const LISTED_SECTIONS: ReadonlyArray<[string, t.ConfigRecord, string, RegExp]> = [
  ['persistence', { favorites: 'mongo' }, 'favorites', /where tool favorites are stored/],
  ['configCache', { maxEntries: 500 }, 'maxEntries', /in-memory config cache/],
];

/** A field's control: a static value where the field is read-only. */
function controlAt(path: string): HTMLElement | null {
  return document.getElementById(path.replaceAll('.', '-'));
}

describe.each(SERVERS)('settings LibreChat reads from librechat.yaml only, on %s', (_, server) => {
  it.each(SECTIONS)('shows %s read-only, and says why', (section, value, key, reason) => {
    renderSections({ sections: [section], yaml: { [section]: value }, contract: server });
    expect(screen.getByRole('note')).toHaveTextContent(reason);
    expect(controlAt(`${section}.${key}`)).toHaveAttribute('data-static-value');
  });

  it('shows the color-mode handoff as read only at startup, inside the editable Interface section', () => {
    renderSections({
      sections: ['interface'],
      yaml: { interface: { colorModeFromUrl: true, landingFooter: 'composer' } },
      contract: server,
    });
    expect(document.querySelector('[data-read-only]')).toBeNull();
    expect(
      screen.getByText(
        /reads the setting below only when it starts, and only from librechat\.yaml/,
      ),
    ).toBeInTheDocument();
    expect(controlAt('interface.colorModeFromUrl')).toHaveAttribute('data-static-value');
    expect(controlAt('interface.landingFooter')).toBeInstanceOf(HTMLSelectElement);
  });

  it("shows skill deletion's cleanup concurrency as managed in librechat.yaml beside editable file settings", () => {
    renderSections({
      sections: ['fileConfig'],
      yaml: {
        fileConfig: { skills: { deletionCleanupConcurrency: 2, importCleanupConcurrency: 3 } },
      },
      contract: server,
    });
    expect(controlAt('fileConfig.skills.deletionCleanupConcurrency')).toHaveAttribute(
      'data-static-value',
    );
    expect(controlAt('fileConfig.skills.importCleanupConcurrency')).toBeInstanceOf(
      HTMLInputElement,
    );
    expect(
      screen.getByText(/Managed in librechat\.yaml until LibreChat applies/),
    ).toBeInTheDocument();
  });
});

describe('sections LibreChat 0.8.531 lists as deployment-only', () => {
  it.each(LISTED_SECTIONS)(
    'shows %s read-only on a server that lists it, and says why',
    (section, value, key, reason) => {
      renderSections({ sections: [section], yaml: { [section]: value }, contract: CURRENT });
      expect(screen.getByRole('note')).toHaveTextContent(reason);
      expect(controlAt(`${section}.${key}`)).toHaveAttribute('data-static-value');
    },
  );
});
