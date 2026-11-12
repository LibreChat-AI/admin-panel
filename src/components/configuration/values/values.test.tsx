import { describe, it, expect, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { render, screen, renderHook, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { baseLayersFixture, scopeLayersFixture, valuesDataFixture } from '@/test/layers';
import { ProvenanceChip, FieldProvenance, ShadowBadge } from './ProvenanceChip';
import { formatConfigValue, getRevertLabels, sourceLabel } from './labels';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { GlobalRevealContext } from '@/contexts/GlobalRevealContext';
import { deriveFieldState, resolveShadowedBy } from '@/utils';
import { useFieldState, useRevertLabels } from '@/hooks';
import { TabCountBadge } from './TabCountBadge';
import { labelForPath } from '../meta';

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}${JSON.stringify(options)}` : key,
}));

const localize = (key: string, options?: Record<string, string | number>): string =>
  options ? `${key}${JSON.stringify(options)}` : key;

function withValues(data: t.ConfigValuesData) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ConfigValuesProvider value={data}>{children}</ConfigValuesProvider>;
  };
}

describe('formatConfigValue', () => {
  it('formats booleans, numbers, text, lists, objects and unset values', () => {
    expect(formatConfigValue(true, localize)).toBe('com_config_values_on');
    expect(formatConfigValue(1000000, localize)).toBe((1000000).toLocaleString());
    expect(formatConfigValue('x'.repeat(60), localize)).toHaveLength(40);
    expect(formatConfigValue(['a', 'b'], localize)).toBe('com_config_values_items{"count":2}');
    expect(formatConfigValue({ a: 1 }, localize)).toBe('com_config_values_keys{"count":1}');
    expect(formatConfigValue(undefined, localize)).toBe('com_config_values_not_set');
  });

  it('never shows credential values', () => {
    expect(formatConfigValue('sk-live-123', localize, 'endpoints.custom.0.apiKey')).toBe(
      '••••••••',
    );
    expect(formatConfigValue('secret', localize, 'webSearch.serperApiKey')).toBe('••••••••');
  });
});

describe('sourceLabel and getRevertLabels', () => {
  const scope = { principalType: PrincipalType.ROLE, name: 'USER' };

  it('names profile sources by principal type', () => {
    expect(sourceLabel('scope', localize, scope)).toBe(
      'com_config_values_source_role{"name":"USER"}',
    );
    expect(sourceLabel('yaml', localize)).toBe('com_config_values_source_yaml{"name":""}');
  });

  it('labels the revert action with the value and layer it reverts to', () => {
    const state = deriveFieldState('balance.startBalance', valuesDataFixture(baseLayersFixture()));
    const labels = getRevertLabels(state, 'Start balance', localize);
    expect(labels?.label).toContain('com_config_values_revert_yaml');
    expect(labels?.label).toContain((1000000).toLocaleString());
    expect(labels?.ariaLabel).toContain('"name":"Start balance"');
  });

  it('says what a profile override inherits once removed', () => {
    const state = deriveFieldState('balance.startBalance', valuesDataFixture(scopeLayersFixture()));
    const labels = getRevertLabels(state, 'Start balance', localize, '', scope);
    expect(labels?.label).toContain('com_config_values_revert_inherited');
    expect(labels?.ariaLabel).toContain('com_config_values_source_role');
  });

  it('has no revert action without an override', () => {
    const state = deriveFieldState('balance.enabled', valuesDataFixture(baseLayersFixture()));
    expect(getRevertLabels(state, 'Enabled', localize)).toBeUndefined();
  });
});

describe('ProvenanceChip', () => {
  it('shows the source and a screen-reader summary of the layer stack', () => {
    const state = deriveFieldState('balance.startBalance', valuesDataFixture(baseLayersFixture()));
    const { container } = render(<ProvenanceChip state={state} path="balance.startBalance" />);
    expect(screen.getByText('com_config_values_source_admin{"name":""}')).toBeTruthy();
    expect(container.querySelector('[data-provenance="admin"]')).toBeTruthy();
    expect(container.textContent).toContain('com_config_values_stack_aria');
  });

  it('marks hidden values and fields shadowed by endpoints.all', () => {
    const scoped = deriveFieldState('mcpServers.docs', valuesDataFixture(scopeLayersFixture()));
    render(<ProvenanceChip state={scoped} />);
    expect(screen.getByText('com_config_values_source_hidden')).toBeTruthy();
    const shadowed = deriveFieldState(
      'endpoints.anthropic.activityModel',
      valuesDataFixture(baseLayersFixture()),
    );
    const { container } = render(<ProvenanceChip state={shadowed} />);
    expect(screen.getByText(/com_config_providers_shadow_label/)).toBeTruthy();
    expect(container.querySelectorAll('.state-chip')).toHaveLength(1);
    expect(container.querySelector('[data-provenance]')).toBeNull();
  });

  it("opens why a shadowed value is ignored, naming the value's own source", () => {
    const shadowed = deriveFieldState(
      'endpoints.anthropic.activityModel',
      valuesDataFixture(baseLayersFixture()),
    );
    const { container } = render(<ProvenanceChip state={shadowed} />);
    const chip = screen.getByRole('button', { name: /com_config_providers_shadow_label/ });
    const reason = container.querySelector('.state-chip-reason') as HTMLElement;
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(reason).not.toBeVisible();
    expect(reason.textContent).not.toContain('com_config_ui_state_edited');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(reason).toBeVisible();
  });

  it('points a title model Global pairs away to the title endpoint Global sets', () => {
    const tree = {
      endpoints: { all: { titleEndpoint: 'anthropic' }, openAI: { titleModel: 'x' } },
    };
    const shadowedBy = resolveShadowedBy('endpoints.openAI.titleModel', tree, {}, 'field')!;
    const reveal = vi.fn();
    const { container } = render(
      <GlobalRevealContext.Provider value={reveal}>
        <ShadowBadge shadowedBy={shadowedBy} source="librechat.yaml" />
      </GlobalRevealContext.Provider>,
    );
    const field = labelForPath('endpoints.all.titleEndpoint', localize);
    expect(container.querySelector('.state-chip-reason')?.textContent).toBe(
      `com_config_providers_shadow_pair${JSON.stringify({ field, source: 'librechat.yaml' })}`,
    );
    fireEvent.click(screen.getByRole('button', { name: /com_config_providers_shadow_go/ }));
    expect(reveal).toHaveBeenCalledWith('endpoints.all.titleEndpoint');
  });

  it('renders nothing for a plain default when asked to', () => {
    const state = deriveFieldState(
      'balance.autoRefillEnabled',
      valuesDataFixture(baseLayersFixture()),
    );
    const { container } = render(<ProvenanceChip state={state} hideDefault />);
    expect(container.textContent).toBe('');
  });

  it('marks an inherited value only when Base sets it', () => {
    const inheritedDefault: t.FieldState = {
      value: undefined,
      effective: undefined,
      source: 'inherited',
      inherited: { value: undefined, source: 'default' },
      isConfigured: false,
      isOverride: false,
      isEdited: false,
      isPendingReset: false,
      isHidden: false,
    };
    const { container, rerender } = render(<ProvenanceChip state={inheritedDefault} hideDefault />);
    expect(container.textContent).toBe('');
    const fromYaml = { ...inheritedDefault, inherited: { value: 5, source: 'yaml' as const } };
    rerender(<ProvenanceChip state={fromYaml} hideDefault />);
    expect(screen.getByText('com_config_values_source_inherited{"name":""}')).toBeTruthy();
  });
});

describe('FieldProvenance and the field hooks', () => {
  it('reads the chip of a path from the provider', () => {
    render(<FieldProvenance path="balance.startBalance" />, {
      wrapper: withValues(valuesDataFixture(scopeLayersFixture())),
    });
    expect(screen.getByText('com_config_values_source_role{"name":"USER"}')).toBeTruthy();
  });

  it('renders nothing outside a provider with the layer model', () => {
    const { container } = render(<FieldProvenance path="balance.startBalance" />);
    expect(container.textContent).toBe('');
  });

  it('derives the field state and revert labels through the hooks', () => {
    const wrapper = withValues(valuesDataFixture(baseLayersFixture()));
    const { result } = renderHook(
      () => ({
        state: useFieldState('balance.startBalance'),
        labels: useRevertLabels('balance.startBalance', 'Start balance'),
      }),
      { wrapper },
    );
    expect(result.current.state.revertTarget).toEqual({ value: 1000000, source: 'yaml' });
    expect(result.current.labels?.label).toContain('com_config_values_revert_yaml');
  });
});

describe('TabCountBadge', () => {
  it('shows the count label and a pending-changes dot', () => {
    render(
      <TabCountBadge
        badge={{
          kind: 'entries',
          count: 1,
          labelKey: 'com_config_values_count_specs',
          pending: 2,
          overrides: 0,
        }}
      />,
    );
    expect(screen.getByText('com_config_values_count_specs{"count":1}')).toBeTruthy();
    expect(screen.getByText('com_config_values_pending{"count":2}')).toBeTruthy();
    expect(screen.queryByText(/com_config_values_overrides/)).toBeNull();
  });

  it('shows the admin overrides apart from the count', () => {
    render(
      <TabCountBadge
        badge={{
          kind: 'customized',
          count: 8,
          labelKey: 'com_config_values_count_set',
          pending: 0,
          overrides: 2,
        }}
      />,
    );
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('com_config_values_count_set{"count":8}')).toBeTruthy();
    expect(screen.getByText('com_config_values_overrides{"count":2}')).toBeTruthy();
  });

  it('renders nothing without a badge', () => {
    const { container } = render(<TabCountBadge />);
    expect(container.textContent).toBe('');
  });
});
