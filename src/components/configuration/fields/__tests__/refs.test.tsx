import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { ModelListField } from '../ModelListField';
import { RefListField } from '../RefListField';
import { ListField } from '../ListField';

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string) => key;
  return { default: () => localize, useLocalize: () => localize };
});

const values: t.ConfigValuesData = {
  configValues: { endpoints: { custom: [{ name: 'Moonshot' }] } },
  editedValues: {},
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  client.setQueryData(['endpointModels', 0], { anthropic: ['claude-a', 'claude-b'] });
  return (
    <QueryClientProvider client={client}>
      <ConfigValuesProvider value={values}>{children}</ConfigValuesProvider>
    </QueryClientProvider>
  );
}

describe('ListField validateItem', () => {
  it('keeps an invalid new item out of the list and says why', () => {
    const onChange = vi.fn();
    render(
      <ListField
        id="list"
        values={[]}
        onChange={onChange}
        validateItem={(value) => (value.includes(':') ? null : 'needs a port')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'localhost' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('needs a port');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'localhost:1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['localhost:1']);
  });
});

describe('RefListField', () => {
  it('picks list items from the option source', () => {
    render(
      <RefListField id="providers" source="endpoints" values={['openAI']} onChange={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByRole('list')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
  });
});

describe('ModelListField with a model source', () => {
  it("shows the provider's models as defaults while the list is unset", () => {
    render(
      <ModelListField
        id="models"
        path="endpoints.anthropic.models"
        source="models:anthropic"
        value={undefined}
        onChange={vi.fn()}
        onClear={vi.fn()}
        aria-label="Models"
      />,
      { wrapper },
    );
    expect(screen.getByText('claude-a')).toBeTruthy();
    expect(screen.getByText('com_config_ctl_models_start_from_defaults')).toBeTruthy();
  });

  it('offers the models not yet listed as suggestions', () => {
    const { container } = render(
      <ModelListField
        id="models"
        path="endpoints.anthropic.models"
        source="models:anthropic"
        value={['claude-a']}
        onChange={vi.fn()}
        onClear={vi.fn()}
        aria-label="Models"
      />,
      { wrapper },
    );
    const options = [...container.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['claude-b']);
  });
});
