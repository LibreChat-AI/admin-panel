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

/** A server reporting data-provider 0.8.530's own lists, which leave these settings out. */
const SERVER = createServerContract(
  {},
  {
    baseOnlySections: [...BASE_ONLY_CONFIG_SECTIONS],
    baseOnlyPaths: [...BASE_ONLY_CONFIG_PATHS],
    deploymentOnlyPaths: { ...DEPLOYMENT_ONLY_CONFIG_PATHS },
  },
);

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

/** A field's control: a static value where the field is read-only. */
function controlAt(path: string): HTMLElement | null {
  return document.getElementById(path.replaceAll('.', '-'));
}

describe('settings LibreChat reads from librechat.yaml without listing them', () => {
  it.each(SECTIONS)(
    'shows %s read-only on a server that reports its rules, and says why',
    (section, value, key, reason) => {
      renderSections({ sections: [section], yaml: { [section]: value }, contract: SERVER });
      expect(screen.getByRole('note')).toHaveTextContent(reason);
      expect(controlAt(`${section}.${key}`)).toHaveAttribute('data-static-value');
    },
  );

  it('shows the color-mode handoff as read only at startup, inside the editable Interface section', () => {
    renderSections({
      sections: ['interface'],
      yaml: { interface: { colorModeFromUrl: true, landingFooter: 'Hi' } },
      contract: SERVER,
    });
    expect(document.querySelector('[data-read-only]')).toBeNull();
    expect(
      screen.getByText(
        /reads the setting below only when it starts, and only from librechat\.yaml/,
      ),
    ).toBeInTheDocument();
    expect(controlAt('interface.colorModeFromUrl')).toHaveAttribute('data-static-value');
    expect(controlAt('interface.landingFooter')).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("shows skill deletion's cleanup concurrency as managed in librechat.yaml beside editable file settings", () => {
    renderSections({
      sections: ['fileConfig'],
      yaml: {
        fileConfig: { skills: { deletionCleanupConcurrency: 2, importCleanupConcurrency: 3 } },
      },
      contract: SERVER,
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
