import { useState } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { configSchema, paramSettings } from 'librechat-data-provider';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type * as t from '@/types';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { HeaderPlaceholders, TagListField } from '../Request';
import { ParamDefinitionsRow } from '../ParamDefinitions';
import { extractSchemaTree } from '@/server/config';
import { KeyValueField } from '../../../fields';
import { EndpointRefRow } from '../Fields';
import { PricingRow } from '../Pricing';

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string, params?: Record<string, string | number>) =>
    params?.name ? `${key}:${params.name}` : key;
  return { default: () => localize, useLocalize: () => localize };
});

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  Element.prototype.scrollIntoView = vi.fn();
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const custom = tree
  .find((field) => field.key === 'endpoints')
  ?.children?.find((field) => field.key === 'custom');
const customParams = custom?.children?.find((field) => field.key === 'customParams');
const paramDefinitionsField = customParams?.children?.find(
  (field) => field.key === 'paramDefinitions',
);
const PATH = 'endpoints.custom.0.customParams.paramDefinitions';

function Params({
  initial,
  lowerKeys = new Set<string>(),
  onChange,
  compact,
  openRouterDefaults,
}: {
  initial: t.ConfigValue[];
  lowerKeys?: ReadonlySet<string>;
  onChange?: (value: t.ConfigValue) => void;
  compact?: boolean;
  openRouterDefaults?: boolean;
}) {
  const [value, setValue] = useState<t.ConfigValue>(initial);
  if (!paramDefinitionsField) throw new Error('no paramDefinitions field');
  return (
    <ParamDefinitionsRow
      path={PATH}
      field={paramDefinitionsField}
      value={value}
      lowerKeys={lowerKeys}
      paramSet="custom"
      compact={compact}
      openRouterDefaults={openRouterDefaults}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

function expandFirstCard(container: HTMLElement) {
  const header = container.querySelector<HTMLButtonElement>(
    '[data-entry-card] button[aria-expanded]',
  );
  if (!header) throw new Error('no card');
  if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header);
}

describe('ParamDefinitionsRow (CE-6)', () => {
  it('titles a definition by its key and shows its default with a control of its type', () => {
    const { container } = render(
      <Params
        initial={[
          {
            key: 'useResponsesApi',
            type: 'boolean',
            component: 'switch',
            default: true,
            label: 'com_endpoint_use_responses_api',
            labelCode: true,
          },
        ]}
      />,
    );
    expect(screen.getByText('useResponsesApi')).toBeInTheDocument();
    expandFirstCard(container);
    const defaultSelect = container.querySelector<HTMLSelectElement>(
      `#${PATH.replace(/\./g, '-')}-0-default`,
    );
    expect(defaultSelect?.value).toBe('true');
    expect(screen.getAllByText('com_config_ce_param_builtin_text').length).toBeGreaterThan(0);
  });

  it('changes the type in one update that drops a component and default that no longer fit', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Params
        initial={[{ key: 'flag', type: 'boolean', component: 'switch', default: true }]}
        onChange={onChange}
      />,
    );
    expandFirstCard(container);
    const type = container.querySelector<HTMLSelectElement>(`#${PATH.replace(/\./g, '-')}-0-type`);
    if (!type) throw new Error('no type select');
    fireEvent.change(type, { target: { value: 'number' } });
    expect(onChange).toHaveBeenLastCalledWith([{ key: 'flag', type: 'number' }]);
    const component = container.querySelector<HTMLSelectElement>(
      `#${PATH.replace(/\./g, '-')}-0-component`,
    );
    const choices = [...(component?.options ?? [])].map((option) => option.value);
    expect(choices).toContain('slider');
    expect(choices).not.toContain('switch');
  });

  it('keeps the key of a definition the layer beneath defines, and offers no delete', () => {
    const { container } = render(
      <Params
        initial={[{ key: 'useResponsesApi', default: false }]}
        lowerKeys={new Set(['useResponsesApi'])}
      />,
    );
    expandFirstCard(container);
    expect(container.querySelector(`input#${PATH.replace(/\./g, '-')}-0-key`)).toBeNull();
    expect(screen.getByText('com_config_ce_param_key_locked')).toBeInTheDocument();
    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).toBeNull();
  });

  it('adds an override of a built-in parameter as its complete definition, shown as a default override', () => {
    const onChange = vi.fn();
    const { container } = render(<Params initial={[]} onChange={onChange} />);
    const select = screen.getByLabelText('com_config_ce_param_add_builtin');
    fireEvent.change(select, { target: { value: 'temperature' } });
    const [added] = onChange.mock.lastCall?.[0] as t.ConfigRecord[];
    const builtIn = paramSettings.custom?.find((setting) => setting.key === 'temperature');
    expect(added).toEqual({ ...builtIn, optionType: 'custom' });
    expect(added).toMatchObject({ type: 'number', component: 'slider', labelCode: true });
    expandFirstCard(container);
    expect(screen.getByText('com_config_ce_param_override_note')).toBeInTheDocument();
    expect(container.querySelector(`#${PATH.replace(/\./g, '-')}-0-type`)).toBeNull();
  });
});

describe('ParamDefinitionsRow, where LibreChat expands definitions (customParamsExpansion)', () => {
  it('adds an override of a built-in parameter as librechat.yaml writes it, { key, default }', () => {
    const onChange = vi.fn();
    const { container } = render(<Params initial={[]} onChange={onChange} compact />);
    expect(screen.getByText('com_config_ce_params_expanded')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('com_config_ce_param_add_builtin'), {
      target: { value: 'temperature' },
    });
    const builtIn = paramSettings.custom?.find((setting) => setting.key === 'temperature');
    expect(onChange.mock.lastCall?.[0]).toEqual([
      { key: 'temperature', default: builtIn?.default },
    ]);
    expandFirstCard(container);
    expect(screen.getByText('com_config_ce_param_override_note')).toBeInTheDocument();
  });

  it("says when LibreChat adds OpenRouter's parameters to the endpoint", () => {
    render(<Params initial={[]} compact openRouterDefaults />);
    expect(screen.getByText('com_config_ce_params_expanded_openrouter')).toBeInTheDocument();
  });
});

describe('TagListField', () => {
  it('adds comma-separated names, skips repeats and clears when the last is removed', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const { rerender } = render(
      <TagListField id="drop" values={['stop']} onChange={onChange} onClear={onClear} />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'user, stop, top_p' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['stop', 'user', 'top_p']);
    rerender(<TagListField id="drop" values={['stop']} onChange={onChange} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_remove_item:stop' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('HeaderPlaceholders', () => {
  it('inserts a placeholder into the header value last focused, never into a header name', () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      render(
        <HeaderPlaceholders>
          <KeyValueField
            id="headers"
            pairs={[{ key: 'X-User', value: 'id-' }]}
            onChange={vi.fn()}
            valueTypes={['string']}
            aria-label="headers"
          />
        </HeaderPlaceholders>,
      );
      const name = screen.getByLabelText<HTMLInputElement>('com_ui_key 1');
      const value = screen.getByLabelText<HTMLInputElement>('com_ui_value 1');
      const placeholder = screen.getByRole('button', { name: '{{LIBRECHAT_USER_ID}}' });

      fireEvent.focus(name);
      fireEvent.click(placeholder);
      expect(name.value).toBe('X-User');
      expect(writeText).toHaveBeenCalledWith('{{LIBRECHAT_USER_ID}}');

      fireEvent.focus(value);
      value.setSelectionRange(3, 3);
      fireEvent.focus(name);
      fireEvent.click(placeholder);
      expect(name.value).toBe('X-User');
      expect(value.value).toBe('id-{{LIBRECHAT_USER_ID}}');
      expect(writeText).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    }
  });
});

describe('PricingRow', () => {
  it('edits rates per model and keeps models the layer beneath prices', () => {
    const onChange = vi.fn();
    render(
      <PricingRow
        path="endpoints.custom.0.tokenConfig"
        value={{ 'model-a': { prompt: 1, completion: 2, context: 1000 }, 'model-b': { prompt: 3 } }}
        models={['model-a', 'model-c']}
        lockedModels={new Set(['model-a'])}
        onChange={onChange}
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('com_config_ce_pricing_missing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'com_ui_remove_item:model-a' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_remove_item:model-b' }));
    expect(onChange).toHaveBeenLastCalledWith({
      'model-a': { prompt: 1, completion: 2, context: 1000 },
    });
    const add = screen.getByPlaceholderText('com_config_ce_pricing_add_placeholder');
    fireEvent.change(add, { target: { value: 'model-c' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ 'model-c': {} }));
  });
});

describe('EndpointRefRow', () => {
  it('leaves out the endpoint being edited by the name LibreChat serves it under', () => {
    const field = custom?.children?.find((child) => child.key === 'titleEndpoint');
    if (!field) throw new Error('no titleEndpoint field');
    const configValues = { endpoints: { custom: [{ name: 'Ollama' }, { name: 'Moonshot' }] } };
    render(
      <ConfigValuesProvider value={{ configValues, editedValues: {} }}>
        <EndpointRefRow
          path="endpoints.custom.0.titleEndpoint"
          field={field}
          value={undefined}
          self="Ollama"
          onChange={vi.fn()}
        />
      </ConfigValuesProvider>,
    );
    const values = screen.getAllByRole('option').map((option) => option.getAttribute('value'));
    expect(values).toContain('Moonshot');
    expect(values).toContain('openAI');
    expect(values).not.toContain('ollama');
    expect(values).not.toContain('Ollama');
  });
});
