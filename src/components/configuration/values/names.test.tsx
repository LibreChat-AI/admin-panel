import { describe, it, expect, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import type * as t from '@/types';
import { baseLayersFixture, scopeLayersFixture, valuesDataFixture } from '@/test/layers';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { isLabelInName, nameWords, visibleText } from '@/test/a11y';
import { FieldChips } from '../sections/endpoints/Chips';
import { getRevertLabels } from './labels';
import { ConfigRow } from '../ConfigRow';
import i18n from '@/locales/i18n';

/**
 * Every control that shows a label and carries a longer accessible name must
 * keep the label's words, in order, at the start of that name (WCAG 2.5.3,
 * label in name), as axe's label-content-name-mismatch checks it.
 */
const localize: t.LocalizeFn = (key, options) => i18n.t(key, options ?? {});

const PATH = 'balance.startBalance';
const ROLE = { principalType: PrincipalType.ROLE, name: 'editor' };

function revertingTo(target: t.RevertTarget): t.FieldState {
  return {
    value: 5,
    effective: 5,
    source: 'scope',
    revertTarget: target,
    isConfigured: true,
    isOverride: true,
    isEdited: false,
    isPendingReset: false,
    isHidden: false,
  };
}

/** Every layer a field's revert can fall back to, and an override that falls back to nothing. */
const TARGETS: ReadonlyArray<readonly [string, t.RevertTarget]> = [
  ['librechat.yaml', { value: 1_000_000, source: 'yaml' }],
  ['the schema default', { value: 20_000, source: 'default' }],
  ['the LibreChat default', { value: 20_000, source: 'runtimeDefault' }],
  ['what Base passes down', { value: 1_000_000, source: 'inherited' }],
  ['a base override', { value: 1_000_000, source: 'admin' }],
  ['a profile value', { value: 1_000_000, source: 'scope' }],
  ['no value at all', { value: undefined, source: 'default' }],
];

describe('isLabelInName (a port of axe-core 4.14 label-content-name-mismatch)', () => {
  it('compares words, ignoring case, punctuation and parenthesized text', () => {
    expect(nameWords('Revert to librechat.yaml (1,000,000): Starting credits')).toEqual([
      'revert',
      'to',
      'librechat',
      'yaml',
      'starting',
      'credits',
    ]);
    expect(isLabelInName('Go to field', 'Go to field: Credits per refill')).toBe(true);
    expect(isLabelInName('Remove override (inherits 1,000,000)', 'Remove override: X')).toBe(true);
  });

  it('fails a name that leaves out a shown word or splits the run', () => {
    expect(isLabelInName('Go to field', 'Go to Credits per refill')).toBe(false);
    expect(
      isLabelInName(
        'Remove override (inherits 1,000,000)',
        'Remove the Role: editor override of Starting credits; it inherits 1,000,000 from Base',
      ),
    ).toBe(false);
    expect(isLabelInName('Reset', 'Remove override for Starting credits')).toBe(false);
  });
});

describe.each(TARGETS)('revert labels, falling back to %s', (_, target) => {
  const labels = getRevertLabels(revertingTo(target), 'Starting credits', localize, PATH, ROLE);

  it('names a control that shows the label with the label first, then the field', () => {
    expect(labels).toBeDefined();
    expect(isLabelInName(labels?.label ?? '', labels?.ariaLabel ?? '')).toBe(true);
    expect(labels?.ariaLabel).toContain('Starting credits');
  });

  it('names a compact "Revert" control starting with "Revert"', () => {
    expect(isLabelInName(localize('com_config_ce_revert'), labels?.compactAriaLabel ?? '')).toBe(
      true,
    );
    expect(labels?.compactAriaLabel).toContain('Starting credits');
  });
});

describe('the change review row actions', () => {
  it.each([
    ['com_config_review_go_to', 'com_config_review_go_to_aria'],
    ['com_config_review_revert', 'com_config_review_revert_aria'],
  ])('%s is the start of %s', (shown, name) => {
    const named = localize(name, { label: 'Credits per refill' });
    expect(isLabelInName(localize(shown), named)).toBe(true);
    expect(named).toContain('Credits per refill');
  });
});

/** The row's own action button (not a state chip's Undo). */
function rowAction(): HTMLElement {
  const action = document.querySelector<HTMLElement>('button.settings-row-action');
  if (!action) throw new Error('no row action');
  return action;
}

function expectLabelInName(button: HTMLElement) {
  const name = button.getAttribute('aria-label') ?? '';
  expect(name).not.toBe('');
  expect(isLabelInName(visibleText(button), name)).toBe(true);
}

describe('ConfigRow reset action', () => {
  function renderRow(data: t.ConfigValuesData | null, props: Partial<t.ConfigRowProps> = {}) {
    const row = (
      <ConfigRow
        title="Starting credits"
        fieldId="balance-startBalance"
        fieldPath={PATH}
        permissions={{ canView: true, canEdit: true }}
        onResetField={vi.fn()}
        {...props}
      >
        <input id="balance-startBalance" />
      </ConfigRow>
    );
    return render(data ? <ConfigValuesProvider value={data}>{row}</ConfigValuesProvider> : row);
  }

  it('names "Remove override (inherits …)" in a profile with the words it shows', () => {
    renderRow(valuesDataFixture(scopeLayersFixture()));
    expect(rowAction()).toHaveTextContent(/^Remove override \(inherits/);
    expectLabelInName(rowAction());
  });

  it('names "Revert to librechat.yaml (…)" on Base with the words it shows', () => {
    renderRow(valuesDataFixture(baseLayersFixture()));
    expect(rowAction()).toHaveTextContent(/^Revert to librechat\.yaml/);
    expectLabelInName(rowAction());
  });

  it('names the fallback "Reset" of a previewed change with "Reset"', () => {
    renderRow(null, { previewChangedPaths: [PATH] });
    expect(rowAction()).toHaveTextContent('Reset');
    expectLabelInName(rowAction());
  });

  it('names the fallback "Reset" of a stored override with "Reset"', () => {
    renderRow(null, { isDbOverride: true });
    expect(rowAction()).toHaveTextContent('Reset');
    expectLabelInName(rowAction());
  });
});

describe('endpoint field chips', () => {
  it('names the compact Revert of a profile override with "Revert"', () => {
    render(
      <ConfigValuesProvider value={valuesDataFixture(scopeLayersFixture())}>
        <FieldChips
          path={PATH}
          label="Starting credits"
          value={777}
          saved={777}
          showOverride
          onChange={vi.fn()}
        />
      </ConfigValuesProvider>,
    );
    const revert = screen.getByRole('button', { name: /^Revert/ });
    expect(visibleText(revert)).toBe('Revert');
    expectLabelInName(revert);
    expect(revert).toHaveAccessibleName(/Starting credits/);
  });
});
