import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { matchVariant, switchVariant, VariantField } from '../VariantField';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { RowProblemsContext } from '@/contexts/RowProblemsContext';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { RecordObjectField } from '../RecordObjectField';
import { ArrayObjectField } from '../ArrayObjectField';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { ObjectEntryCard } from '../ObjectEntryCard';
import { KeyValueField } from '../KeyValueField';
import { createField } from '@/test/fixtures';
import { createPathIndex } from '@/utils';
import { ListField } from '../ListField';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  useLocalize: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const nameField = createField({ key: 'name', type: 'string', path: 'list.[].name' });
const renderNameFields: t.CollectionRenderFields = (_fields, value, parentPath, onChange) => {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return (
    <input
      id={`${parentPath}-name`}
      aria-label={`name of ${parentPath}`}
      value={typeof record.name === 'string' ? record.name : ''}
      onChange={(e) => onChange('name', e.target.value)}
    />
  );
};

/** Holds the list in state, like the page does, and records every emitted value. */
function StatefulList({
  initial,
  onEmit,
  editSessionId = 0,
  reorderable,
}: {
  initial: t.ConfigValue[];
  onEmit: (value: t.ConfigValue) => void;
  editSessionId?: number;
  reorderable?: boolean;
}) {
  const [value, setValue] = useState<t.ConfigValue>(initial);
  return (
    <>
      <button
        type="button"
        onClick={() => setValue([...(value as t.ConfigValue[]), { name: 'external' }])}
      >
        append externally
      </button>
      <ArrayObjectField
        id="list"
        path="list"
        value={value}
        fields={[nameField]}
        onChange={(next) => {
          onEmit(next);
          setValue(next);
        }}
        renderFields={renderNameFields}
        editSessionId={editSessionId}
        reorderable={reorderable}
      />
    </>
  );
}

describe('ObjectEntryCard', () => {
  const baseProps = {
    entryKey: 'Zai 2',
    dataPath: 'endpoints.custom.3',
    fields: [nameField],
    value: { name: 'Zai 2' },
    renderFields: renderNameFields,
  };

  it('has one header button with aria-expanded, and actions as siblings', () => {
    render(<ObjectEntryCard {...baseProps} onValueChange={vi.fn()} onRemove={vi.fn()} />);
    const header = screen.getByRole('button', { expanded: false });
    expect(header).toHaveTextContent('Zai 2');
    const remove = screen.getByRole('button', { name: 'com_ui_delete Zai 2' });
    expect(header.contains(remove)).toBe(false);
    expect(remove.closest('button[aria-expanded]')).toBeNull();
  });

  it('toggles with Enter/Space on the header and deletes with Enter on Delete without toggling', () => {
    const onRemove = vi.fn();
    render(<ObjectEntryCard {...baseProps} onValueChange={vi.fn()} onRemove={onRemove} />);
    const header = screen.getByRole('button', { expanded: false });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    const remove = screen.getByRole('button', { name: 'com_ui_delete Zai 2' });
    remove.focus();
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('derives field ids from the data path, not the display name', () => {
    render(<ObjectEntryCard {...baseProps} onValueChange={vi.fn()} defaultExpanded />);
    expect(document.getElementById('endpoints.custom.3-name')).not.toBeNull();
    expect(document.querySelector('[id="Zai 2-name"]')).toBeNull();
  });

  it('merges two field changes made in the same tick', () => {
    const onValueChange = vi.fn();
    const twoChanges: t.CollectionRenderFields = (_f, _v, _p, onChange) => (
      <button
        type="button"
        onClick={() => {
          onChange('type', 'number');
          onChange('component', undefined);
        }}
      >
        change type
      </button>
    );
    render(
      <ObjectEntryCard
        {...baseProps}
        value={{ key: 'temp', type: 'boolean', component: 'switch' }}
        renderFields={twoChanges}
        onValueChange={onValueChange}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'change type' }));
    expect(onValueChange).toHaveBeenLastCalledWith({ key: 'temp', type: 'number' });
  });

  it('expands on config:expand and collapses on config:collapse', () => {
    const { container } = render(<ObjectEntryCard {...baseProps} onValueChange={vi.fn()} />);
    const card = container.querySelector('[data-entry-card]')!;
    fireEvent(card, new Event('config:expand'));
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    fireEvent(card, new Event('config:collapse'));
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
  });

  it('applies defaultExpanded when it turns true after mount', () => {
    const { rerender } = render(<ObjectEntryCard {...baseProps} onValueChange={vi.fn()} />);
    rerender(<ObjectEntryCard {...baseProps} onValueChange={vi.fn()} defaultExpanded />);
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });
});

describe('ArrayObjectField', () => {
  it('appends a new entry at the end, expanded and marked New', () => {
    const onEmit = vi.fn();
    render(<StatefulList initial={[{ name: 'first' }]} onEmit={onEmit} />);
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    expect(onEmit).toHaveBeenLastCalledWith([{ name: 'first' }, {}]);
    const headers = screen.getAllByRole('button', { expanded: true });
    expect(headers).toHaveLength(1);
    expect(headers[0]).toHaveTextContent('com_config_ctl_entry_new');
    expect(document.getElementById('list.1-name')).not.toBeNull();
  });

  it('expands an entry appended from outside (e.g. a create dialog)', () => {
    render(<StatefulList initial={[{ name: 'first' }]} onEmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'append externally' }));
    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent('external');
  });

  it('marks a deleted entry pending with Undo, which restores it at its position', () => {
    const onEmit = vi.fn();
    render(
      <StatefulList initial={[{ name: 'a' }, { name: 'b' }, { name: 'c' }]} onEmit={onEmit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete b' }));
    expect(onEmit).toHaveBeenLastCalledWith([{ name: 'a' }, { name: 'c' }]);
    expect(screen.getByText('com_config_ctl_entry_pending_delete')).toBeInTheDocument();
    const undo = screen.getByRole('button', { name: /com_config_ctl_entry_undo_a11y/ });
    expect(undo).toHaveFocus();
    fireEvent.click(undo);
    expect(onEmit).toHaveBeenLastCalledWith([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    expect(screen.queryByText('com_config_ctl_entry_pending_delete')).not.toBeInTheDocument();
  });

  it('gives focus to the restored entry after Undo', async () => {
    render(
      <StatefulList initial={[{ name: 'a' }, { name: 'b' }, { name: 'c' }]} onEmit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete b' }));
    fireEvent.click(screen.getByRole('button', { name: /com_config_ctl_entry_undo_a11y/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^b/, expanded: false })).toHaveFocus(),
    );
  });

  it('keeps an entry expanded while another one is deleted (stable keys)', () => {
    render(
      <StatefulList initial={[{ name: 'a' }, { name: 'b' }, { name: 'c' }]} onEmit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^c/, expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete a' }));
    expect(screen.getByRole('button', { name: /^c/, expanded: true })).toBeInTheDocument();
  });

  it('moves an open entry with its state and keeps focus on its move button', async () => {
    render(
      <StatefulList
        initial={[{ name: 'a' }, { name: 'b' }, { name: 'c' }]}
        onEmit={vi.fn()}
        reorderable
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^b/, expanded: false }));
    const up = screen.getByRole('button', { name: 'com_config_ctl_entry_move_up:{"name":"b"}' });
    up.focus();
    fireEvent.click(up);
    expect(screen.getByRole('button', { name: /^b/, expanded: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^a/, expanded: false })).toBeInTheDocument();
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).toHaveAttribute(
      'aria-label',
      'com_config_ctl_entry_move_down:{"name":"b"}',
    );
  });

  it('shows an empty state even when the add button lives elsewhere', () => {
    render(
      <ArrayObjectField
        id="l"
        value={[]}
        fields={[nameField]}
        onChange={vi.fn()}
        renderFields={renderNameFields}
        hideAddButton
      />,
    );
    expect(screen.getByText('com_config_no_entries')).toBeInTheDocument();
  });

  it('keeps a deleted entry listed, with Undo, while the tab filter is on', () => {
    function Filtered() {
      const [value, setValue] = useState<t.ConfigValue>([{ name: 'a' }, { name: 'b' }]);
      return (
        <RowFilterContext.Provider value={createPathIndex(['list.0.name'])}>
          <ArrayObjectField
            id="l"
            path="list"
            value={value}
            fields={[nameField]}
            onChange={setValue}
            renderFields={renderNameFields}
          />
        </RowFilterContext.Provider>
      );
    }
    render(<Filtered />);
    expect(screen.queryByRole('button', { name: 'com_ui_delete b' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete a' }));
    expect(screen.getByText('com_config_ctl_entry_pending_delete')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /com_config_ctl_entry_undo_a11y/ }),
    ).toBeInTheDocument();
  });

  it('hides delete for locked entries', () => {
    render(
      <ArrayObjectField
        id="l"
        value={[{ name: 'yaml' }, { name: 'db' }]}
        fields={[nameField]}
        onChange={vi.fn()}
        renderFields={renderNameFields}
        isEntryLocked={(item) => (item as t.ConfigRecord).name === 'yaml'}
      />,
    );
    expect(screen.queryByRole('button', { name: 'com_ui_delete yaml' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_ui_delete db' })).toBeInTheDocument();
  });
});

describe('RecordObjectField', () => {
  it('offers no rename or delete for keys the layer beneath defines (D3)', () => {
    render(
      <RecordObjectField
        id="vars"
        path="mcpServers.github.customUserVars"
        value={{ PAT_TOKEN: { title: 'PAT' }, OWN: { title: 'Own' } }}
        fields={[]}
        onChange={vi.fn()}
        renderFields={renderNameFields}
        lockedKeys={new Set(['PAT_TOKEN'])}
      />,
    );
    expect(screen.queryByRole('button', { name: 'com_ui_delete PAT_TOKEN' })).toBeNull();
    expect(screen.getByRole('button', { name: 'com_ui_delete OWN' })).toBeInTheDocument();
    expect(screen.getAllByTitle(/com_a11y_rename_entry/)).toHaveLength(1);
    expect(screen.getByTitle('com_config_ctl_kv_locked')).toBeInTheDocument();
  });
});

describe('record keys the server cannot store', () => {
  const dotted: t.ConfigContract = {
    ...BUNDLED_CONFIG_CONTRACT,
    features: { ...BUNDLED_CONFIG_CONTRACT.features, dottedKeys: true },
  };

  function addKey(key: string, contract?: t.ConfigContract) {
    const onChange = vi.fn();
    const field = (
      <RecordObjectField
        id="profiles"
        path="fileConfig.endpoints"
        value={{}}
        fields={[]}
        onChange={onChange}
        allowPrimitiveValues
        renderFields={renderNameFields}
      />
    );
    render(
      contract ? (
        <ConfigContractContext.Provider value={contract}>{field}</ConfigContractContext.Provider>
      ) : (
        field
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'com_ui_key' }), {
      target: { value: key },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_add' }));
    return onChange;
  }

  it('refuses a dotted key on a server that drops it', () => {
    const onChange = addKey('image/svg+xml.v2');
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_unsafe_key_error');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts a dotted key on a server that keeps dotted keys', () => {
    const onChange = addKey('us.anthropic.claude', dotted);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ 'us.anthropic.claude': true });
  });

  it('still refuses a $ key on a server that keeps dotted keys', () => {
    const onChange = addKey('$where', dotted);
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_reserved_key_error');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('flags a dotted key/value key only on a server that drops it', () => {
    const pairs = [{ key: 'x-portkey.config', value: 'cfg', valueType: 'string' as const }];
    const { unmount } = render(
      <KeyValueField id="kv" pairs={pairs} onChange={vi.fn()} onClear={vi.fn()} />,
    );
    expect(screen.getByText('com_config_unsafe_key_error')).toBeInTheDocument();
    unmount();
    render(
      <ConfigContractContext.Provider value={dotted}>
        <KeyValueField id="kv" pairs={pairs} onChange={vi.fn()} onClear={vi.fn()} />
      </ConfigContractContext.Provider>,
    );
    expect(screen.queryByText('com_config_unsafe_key_error')).not.toBeInTheDocument();
  });
});

describe('VariantField', () => {
  const idVariant: t.FieldVariant = {
    key: 'existing',
    fields: [
      createField({ key: 'enabled', type: 'boolean' }),
      createField({ key: 'id', type: 'string' }),
    ],
  };
  const inlineVariant: t.FieldVariant = {
    key: 'inline',
    fields: [
      createField({ key: 'enabled', type: 'boolean' }),
      createField({ key: 'provider', type: 'string' }),
      createField({ key: 'model', type: 'string' }),
    ],
  };
  const renderFields: t.VariantFieldProps['renderFields'] = (fields) => (
    <span>{fields.map((f) => f.key).join(',')}</span>
  );

  it('matches the branch by keys or discriminator', () => {
    expect(matchVariant({ id: 'agent_1' }, [idVariant, inlineVariant])?.key).toBe('existing');
    expect(matchVariant({ provider: 'openAI', model: 'x' }, [idVariant, inlineVariant])?.key).toBe(
      'inline',
    );
    const typed = [
      { key: 'token_ratio', discriminatorValue: 'token_ratio', fields: [] },
      { key: 'message_count', discriminatorValue: 'message_count', fields: [] },
    ];
    expect(matchVariant({ type: 'message_count', value: 3 }, typed, 'type')?.key).toBe(
      'message_count',
    );
  });

  it('keeps shared keys and lists lower-layer keys to tombstone when switching', () => {
    const result = switchVariant({ enabled: true, id: 'agent_1' }, inlineVariant, undefined, [
      'id',
    ]);
    expect(result.value).toEqual({ enabled: true });
    expect(result.tombstones).toEqual(['id']);
  });

  it('emits tombstones for librechat.yaml keys the new branch drops, then writes the whole object', () => {
    const onChange = vi.fn();
    const onTombstone = vi.fn();
    render(
      <VariantField
        id="v"
        value={{ enabled: true, id: 'agent_1' }}
        variants={[idVariant, inlineVariant]}
        inheritedKeys={['id']}
        onChange={onChange}
        onTombstone={onTombstone}
        renderFields={renderFields}
      />,
    );
    expect(screen.getByText('enabled,id')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inline' } });
    expect(onTombstone).toHaveBeenCalledWith(['id']);
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });

  it('explains instead of switching when lower-layer keys cannot be hidden', () => {
    const onChange = vi.fn();
    render(
      <VariantField
        id="v"
        value={{ id: 'agent_1' }}
        variants={[idVariant, inlineVariant]}
        inheritedKeys={['id']}
        onChange={onChange}
        renderFields={renderFields}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inline' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_variant_blocked');
  });

  it('keeps the chosen branch while the value fits none, without writing an empty object', () => {
    const onChange = vi.fn();
    const variants: t.FieldVariant[] = [
      { key: 'id', fields: [createField({ key: 'id', type: 'string' })] },
      {
        key: 'provider',
        fields: [
          createField({ key: 'provider', type: 'string' }),
          createField({ key: 'model', type: 'string' }),
        ],
      },
    ];
    render(
      <VariantField
        id="v"
        value={undefined}
        variants={variants}
        onChange={onChange}
        renderFields={renderFields}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'provider' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveValue('provider');
    expect(screen.getByText('provider,model')).toBeInTheDocument();
  });

  it('drops its own value when switching to a branch that keeps none of it', () => {
    const onChange = vi.fn();
    render(
      <VariantField
        id="v"
        value={{ id: 'agent_1' }}
        variants={[
          { key: 'id', fields: [createField({ key: 'id', type: 'string' })] },
          { key: 'provider', fields: [createField({ key: 'provider', type: 'string' })] },
        ]}
        onChange={onChange}
        renderFields={renderFields}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'provider' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('sets the discriminator when switching a discriminated union', () => {
    const onChange = vi.fn();
    const variants: t.FieldVariant[] = [
      {
        key: 'token_ratio',
        discriminatorValue: 'token_ratio',
        fields: [createField({ key: 'type' }), createField({ key: 'value', type: 'number' })],
      },
      {
        key: 'message_count',
        discriminatorValue: 'message_count',
        fields: [createField({ key: 'type' }), createField({ key: 'value', type: 'number' })],
      },
    ];
    render(
      <VariantField
        id="v"
        value={{ type: 'token_ratio', value: 0.8 }}
        variants={variants}
        discriminator="type"
        onChange={onChange}
        renderFields={renderFields}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'message_count' } });
    expect(onChange).toHaveBeenCalledWith({ value: 0.8, type: 'message_count' });
  });
});

describe('KeyValueField', () => {
  it('keeps a new row local until it has a key, then infers the value type', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <KeyValueField id="kv" pairs={[]} onChange={onChange} onClear={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    expect(onChange).not.toHaveBeenCalled();
    const key = screen.getByRole('textbox', { name: 'com_ui_key 1' });
    fireEvent.change(key, { target: { value: 'max_tokens' } });
    fireEvent.blur(key);
    expect(onChange).toHaveBeenLastCalledWith([
      { key: 'max_tokens', value: '', valueType: 'string' },
    ]);
    rerender(
      <KeyValueField
        id="kv"
        pairs={[{ key: 'max_tokens', value: '', valueType: 'string' }]}
        onChange={onChange}
        onClear={vi.fn()}
      />,
    );
    const value = screen.getByRole('textbox', { name: 'com_ui_value 1' });
    fireEvent.change(value, { target: { value: '4096' } });
    fireEvent.blur(value);
    expect(onChange).toHaveBeenLastCalledWith([
      { key: 'max_tokens', value: '4096', valueType: 'number' },
    ]);
  });

  it('keeps the new row (and the focused value input) when its key commits', () => {
    function Stateful() {
      const [pairs, setPairs] = useState<t.KeyValuePair[]>([]);
      return <KeyValueField id="kv" pairs={pairs} onChange={setPairs} onClear={vi.fn()} />;
    }
    render(<Stateful />);
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    const key = screen.getByRole('textbox', { name: 'com_ui_key 1' });
    const value = screen.getByRole('textbox', { name: 'com_ui_value 1' });
    fireEvent.change(key, { target: { value: 'X-Org' } });
    value.focus();
    fireEvent.blur(key);
    expect(screen.getByRole('textbox', { name: 'com_ui_value 1' })).toBe(value);
    expect(document.activeElement).toBe(value);
  });

  it('calls onClear when the last row is removed', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <KeyValueField
        id="kv"
        pairs={[{ key: 'a', value: '1' }]}
        onChange={onChange}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete a' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('flags a blank key and keeps its row a draft, so no header named "  " is saved', () => {
    const onChange = vi.fn();
    render(<KeyValueField id="kv" pairs={[]} onChange={onChange} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    const key = screen.getByRole('textbox', { name: 'com_ui_key 1' });
    fireEvent.change(key, { target: { value: '  ' } });
    fireEvent.blur(key);
    const value = screen.getByRole('textbox', { name: 'com_ui_value 1' });
    fireEvent.change(value, { target: { value: 'value-only' } });
    fireEvent.blur(value);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_kv_blank_key');
  });

  it('keeps a saved row whose key is cleared or made blank, flagging it until fixed', () => {
    const onChange = vi.fn();
    render(
      <KeyValueField
        id="kv"
        pairs={[
          { key: 'X-A', value: '1' },
          { key: 'X-B', value: '2' },
        ]}
        onChange={onChange}
        onClear={vi.fn()}
      />,
    );
    const key = screen.getByRole('textbox', { name: 'com_ui_key 1' });
    fireEvent.change(key, { target: { value: '' } });
    fireEvent.blur(key);
    expect(onChange).not.toHaveBeenCalled();
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_kv_key_cleared');
    fireEvent.change(key, { target: { value: '   ' } });
    fireEvent.blur(key);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_kv_blank_key');
    fireEvent.change(key, { target: { value: 'X-C' } });
    fireEvent.blur(key);
    expect(onChange).toHaveBeenLastCalledWith([
      { key: 'X-C', value: '1' },
      { key: 'X-B', value: '2' },
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses renaming a saved key to one already in the list, keeping the text with an error', () => {
    const onChange = vi.fn();
    const report = vi.fn();
    render(
      <RowProblemsContext.Provider value={report}>
        <KeyValueField
          id="kv"
          pairs={[
            { key: 'X-A', value: 'a' },
            { key: 'X-B', value: 'b' },
          ]}
          onChange={onChange}
        />
      </RowProblemsContext.Provider>,
    );
    const key = screen.getByRole('textbox', { name: 'com_ui_key 2' });
    fireEvent.change(key, { target: { value: 'X-A' } });
    fireEvent.blur(key);
    expect(onChange).not.toHaveBeenCalled();
    expect(key).toHaveValue('X-A');
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_kv_duplicate');
    expect(report).toHaveBeenLastCalledWith('kv', 1);
  });

  it('renames a saved key on blur or Enter only, never on a pause while typing', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<KeyValueField id="kv" pairs={[{ key: 'X-B', value: 'b' }]} onChange={onChange} />);
      const key = screen.getByRole('textbox', { name: 'com_ui_key 1' });
      fireEvent.change(key, { target: { value: 'X-' } });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.change(key, { target: { value: 'X-Z' } });
      fireEvent.keyDown(key, { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith([{ key: 'X-Z', value: 'b' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers only text in string-only mode', () => {
    render(
      <KeyValueField
        id="kv"
        pairs={[{ key: 'en', value: 'Hi' }]}
        onChange={vi.fn()}
        valueTypes={['string']}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

describe('ListField', () => {
  it('keeps a new row as a draft, rejects duplicates and keeps item whitespace', () => {
    const onChange = vi.fn();
    render(
      <ListField id="l" values={['\n\nHuman:', 'STOP']} onChange={onChange} onClear={vi.fn()} />,
    );
    expect(screen.getByRole('textbox', { name: 'com_ui_item 1' })).toHaveValue('\n\nHuman:');
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    expect(onChange).not.toHaveBeenCalled();
    const draft = screen.getByRole('textbox', { name: 'com_ui_item 3' });
    fireEvent.change(draft, { target: { value: 'STOP' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_list_duplicate');
    fireEvent.change(draft, { target: { value: ' ###' } });
    fireEvent.blur(draft);
    expect(onChange).toHaveBeenLastCalledWith(['\n\nHuman:', 'STOP', ' ###']);
  });

  it('drops an item edited to only spaces', () => {
    const onChange = vi.fn();
    render(<ListField id="l" values={['a.com', 'b.com']} onChange={onChange} onClear={vi.fn()} />);
    const item = screen.getByRole('textbox', { name: 'com_ui_item 1' });
    fireEvent.change(item, { target: { value: '   ' } });
    fireEvent.blur(item);
    expect(onChange).toHaveBeenLastCalledWith(['b.com']);
  });

  it('keeps whitespace-only stop sequences ("\\n", " ") with keepsWhitespace', () => {
    const onChange = vi.fn();
    render(
      <ListField
        id="l"
        values={['\n', 'STOP']}
        onChange={onChange}
        onClear={vi.fn()}
        keepsWhitespace
      />,
    );
    const stop = screen.getByRole('textbox', { name: 'com_ui_item 1' });
    expect(stop).toHaveValue('\n');
    fireEvent.change(stop, { target: { value: '\n\n' } });
    fireEvent.blur(stop);
    expect(onChange).toHaveBeenLastCalledWith(['\n\n', 'STOP']);
    fireEvent.click(screen.getByRole('button', { name: /com_ui_add_item/ }));
    const draft = screen.getByRole('textbox', { name: 'com_ui_item 3' });
    fireEvent.change(draft, { target: { value: ' ' } });
    fireEvent.blur(draft);
    expect(onChange).toHaveBeenLastCalledWith(['\n', 'STOP', ' ']);
  });

  it('resets the field instead of saving [] when the last item is removed', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<ListField id="l" values={['example.com']} onChange={onChange} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete example.com' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
