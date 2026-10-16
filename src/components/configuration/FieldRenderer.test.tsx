import { useMemo, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { SingleFieldRenderer, FieldRenderer, renderInlineField } from './FieldRenderer';
import { applyConfigEdit, buildSavePayload, mergeIndexedArrayEdits } from './utils';
import { createField } from '@/test/fixtures';
import { flattenObject } from '@/utils';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string) => key,
  useLocalize: () => (key: string) => key,
}));

interface MockSwitchProps {
  checked: boolean;
  'aria-label'?: string;
  onCheckedChange?: (checked: boolean) => void;
}
interface MockSelectProps {
  children: React.ReactNode;
  value: string;
  'aria-label'?: string;
}
interface MockSelectItemProps {
  children: React.ReactNode;
  value: string;
}
interface MockIconProps {
  name: string;
}
interface MockButtonProps {
  label: string;
  onClick?: () => void;
}
interface MockTextFieldProps {
  id?: string;
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  type?: string;
  disabled?: boolean;
  'aria-label'?: string;
}
interface MockNumberFieldProps {
  id?: string;
  value?: string | number;
  placeholder?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}
interface MockIconButtonProps {
  icon: string;
  onClick?: () => void;
  'aria-label'?: string;
}

vi.mock('@clickhouse/click-ui', () => ({
  Switch: (props: MockSwitchProps) => (
    <button
      role="switch"
      aria-checked={props.checked}
      aria-label={props['aria-label']}
      data-testid="toggle"
      onClick={() => props.onCheckedChange?.(!props.checked)}
    />
  ),
  Select: Object.assign(
    ({ children, value, ...props }: MockSelectProps) => (
      <div data-testid="select" data-value={value} aria-label={props['aria-label']}>
        {children}
      </div>
    ),
    {
      Item: ({ children, value }: MockSelectItemProps) => (
        <div data-testid="select-item" data-value={value}>
          {children}
        </div>
      ),
    },
  ),
  Icon: ({ name }: MockIconProps) => <span data-testid={`icon-${name}`} />,
  Button: ({ label, onClick }: MockButtonProps) => <button onClick={onClick}>{label}</button>,
  IconButton: ({ icon, onClick, ...props }: MockIconButtonProps) => (
    <button
      onClick={onClick}
      aria-label={props['aria-label'] ?? icon}
      data-testid={`icon-button-${icon}`}
    />
  ),
  TextField: ({
    id,
    value,
    placeholder,
    onChange,
    onBlur,
    type,
    disabled,
    ...rest
  }: MockTextFieldProps) => (
    <input
      id={id}
      value={value ?? ''}
      placeholder={placeholder}
      type={type ?? 'text'}
      disabled={disabled}
      aria-label={rest['aria-label']}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onBlur}
    />
  ),
  NumberField: ({ id, value, placeholder, onChange, onBlur }: MockNumberFieldProps) => (
    <input
      id={id}
      value={value ?? ''}
      placeholder={placeholder}
      type="number"
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onBlur}
    />
  ),
}));

const noop = () => {};
const getValue = (_path: string, fallback: t.ConfigValue) => fallback;

describe('SingleFieldRenderer', () => {
  it('renders a toggle for boolean fields', () => {
    const field = createField({ key: 'enabled', type: 'boolean' });
    render(
      <SingleFieldRenderer
        field={field}
        value={true}
        path="section.enabled"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('renders a select for enum fields with correct options', () => {
    const field = createField({ key: 'theme', type: 'enum(dark | light | system)' });
    render(
      <SingleFieldRenderer
        field={field}
        value="dark"
        path="section.theme"
        getValue={getValue}
        onChange={noop}
      />,
    );
    const items = screen.getAllByTestId('select-item');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Dark');
    expect(items[1]).toHaveTextContent('Light');
    expect(items[2]).toHaveTextContent('System');
  });

  it('renders a text input for string fields', () => {
    const field = createField({ key: 'title', type: 'string' });
    render(
      <SingleFieldRenderer
        field={field}
        value="Hello"
        path="section.title"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('Hello');
  });

  it('renders a number input for number fields', () => {
    const field = createField({ key: 'port', type: 'number' });
    render(
      <SingleFieldRenderer
        field={field}
        value={3000}
        path="section.port"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByRole('spinbutton')).toHaveValue(3000);
  });

  it('renders a list for array<string> fields', () => {
    const field = createField({ key: 'domains', type: 'array<string>', isArray: true });
    render(
      <SingleFieldRenderer
        field={field}
        value={['example.com', 'test.org']}
        path="section.domains"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByDisplayValue('example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test.org')).toBeInTheDocument();
  });

  it('renders key-value pairs for record fields', () => {
    const field = createField({ key: 'headers', type: 'record' });
    render(
      <SingleFieldRenderer
        field={field}
        value={{ Authorization: 'Bearer token' }}
        path="section.headers"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByDisplayValue('Authorization')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bearer token')).toBeInTheDocument();
  });
});

describe('FieldRenderer with imported config values', () => {
  it('populates fields from a config values object', () => {
    const fields = [
      createField({ key: 'title', type: 'string', path: 'interface.title' }),
      createField({ key: 'port', type: 'number', path: 'interface.port' }),
      createField({ key: 'enabled', type: 'boolean', path: 'interface.enabled' }),
    ];
    const configValues = { title: 'My App', port: 8080, enabled: true };
    const editedValues: Record<string, t.ConfigValue> = {};
    const getValueWithEdits = (path: string, fallback: t.ConfigValue) =>
      path in editedValues ? editedValues[path] : fallback;

    render(
      <FieldRenderer
        fields={fields}
        parentValue={configValues}
        parentPath="interface"
        getValue={getValueWithEdits}
        onChange={noop}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveValue('My App');
    expect(screen.getByRole('spinbutton')).toHaveValue(8080);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('edited values take precedence over imported values', () => {
    const fields = [createField({ key: 'title', type: 'string', path: 'section.title' })];
    const configValues = { title: 'Original' };
    const editedValues: Record<string, t.ConfigValue> = { 'section.title': 'Edited' };
    const getValueWithEdits = (path: string, fallback: t.ConfigValue) =>
      path in editedValues ? editedValues[path] : fallback;

    render(
      <FieldRenderer
        fields={fields}
        parentValue={configValues}
        parentPath="section"
        getValue={getValueWithEdits}
        onChange={noop}
      />,
    );

    expect(screen.getByRole('textbox')).toHaveValue('Edited');
  });
});

describe('schema evolution: new fields render dynamically', () => {
  it('a new string field added to the schema renders a text input', () => {
    const v1Fields = [createField({ key: 'title', type: 'string', path: 'section.title' })];
    const v2Fields = [
      ...v1Fields,
      createField({ key: 'subtitle', type: 'string', path: 'section.subtitle' }),
    ];

    const { unmount } = render(
      <FieldRenderer
        fields={v1Fields}
        parentValue={{}}
        parentPath="section"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    unmount();

    render(
      <FieldRenderer
        fields={v2Fields}
        parentValue={{}}
        parentPath="section"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
  });

  it('a new boolean field renders a toggle without code changes', () => {
    const fields = [
      createField({ key: 'existing', type: 'string', path: 'section.existing' }),
      createField({ key: 'newFeatureFlag', type: 'boolean', path: 'section.newFeatureFlag' }),
    ];

    render(
      <FieldRenderer
        fields={fields}
        parentValue={{}}
        parentPath="section"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('a new enum field renders a select with correct options', () => {
    const fields = [
      createField({
        key: 'newMode',
        type: 'enum(fast | balanced | quality)',
        path: 'section.newMode',
      }),
    ];

    render(
      <FieldRenderer
        fields={fields}
        parentValue={{ newMode: 'fast' }}
        parentPath="section"
        getValue={getValue}
        onChange={noop}
      />,
    );
    const items = screen.getAllByTestId('select-item');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Fast');
    expect(items[1]).toHaveTextContent('Balanced');
    expect(items[2]).toHaveTextContent('Quality');
  });

  it('a new nested object field renders its children recursively', () => {
    const fields = [
      createField({
        key: 'newSection',
        type: 'object',
        isObject: true,
        path: 'root.newSection',
        children: [
          createField({ key: 'name', type: 'string', path: 'root.newSection.name' }),
          createField({ key: 'count', type: 'number', path: 'root.newSection.count' }),
        ],
      }),
    ];

    render(
      <FieldRenderer
        fields={fields}
        parentValue={{ newSection: { name: 'Test', count: 42 } }}
        parentPath="root"
        getValue={getValue}
        onChange={noop}
      />,
    );
    const toggle = screen.getByRole('button', { expanded: false });
    fireEvent.click(toggle);
    expect(screen.getByRole('textbox')).toHaveValue('Test');
    expect(screen.getByRole('spinbutton')).toHaveValue(42);
  });
});

describe('SingleFieldRenderer onChange interactions', () => {
  it('calls onChange with updated value when text input changes', () => {
    const onChange = vi.fn();
    const field = createField({ key: 'title', type: 'string' });
    render(
      <SingleFieldRenderer
        field={field}
        value="old"
        path="s.title"
        getValue={getValue}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('s.title', 'new');
  });

  it('calls onChange with updated value when number input changes', () => {
    const onChange = vi.fn();
    const field = createField({ key: 'port', type: 'number' });
    render(
      <SingleFieldRenderer
        field={field}
        value={3000}
        path="s.port"
        getValue={getValue}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '8080' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('s.port', 8080);
  });

  it('calls onChange with toggled value when switch is clicked', () => {
    const onChange = vi.fn();
    const field = createField({ key: 'enabled', type: 'boolean' });
    render(
      <SingleFieldRenderer
        field={field}
        value={false}
        path="s.enabled"
        getValue={getValue}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith('s.enabled', true);
  });
});

describe('masked secret fields', () => {
  const secretFields = [createField({ key: 'apiKey', type: 'string', path: 'ocr.apiKey' })];
  const maskedParent = { apiKeyPreview: 'sk-mist...4321' };

  const renderMasked = (onChange = noop, extra: Partial<t.FieldRendererProps> = {}) =>
    render(
      <FieldRenderer
        fields={secretFields}
        parentValue={maskedParent}
        parentPath="ocr"
        getValue={getValue}
        onChange={onChange}
        {...extra}
      />,
    );

  it('renders the masked display read-only when the display companion is set', () => {
    const onChange = vi.fn();
    renderMasked(onChange);
    const masked = screen.getByDisplayValue('sk-mist...4321');
    expect(masked).toBeDisabled();
    expect(screen.getByText('com_config_secret_replace')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a normal empty input when no display companion is set', () => {
    render(
      <FieldRenderer
        fields={secretFields}
        parentValue={{}}
        parentPath="ocr"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByRole('textbox')).not.toBeDisabled();
    expect(screen.queryByText('com_config_secret_replace')).not.toBeInTheDocument();
  });

  it('replace flow submits only the newly typed secret, never the masked value', () => {
    const onChange = vi.fn();
    renderMasked(onChange);
    fireEvent.click(screen.getByText('com_config_secret_replace'));
    const input = screen.getByRole('textbox');
    expect(input).not.toBeDisabled();
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'brand-new-secret' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ocr.apiKey', 'brand-new-secret');
  });

  it('cancelling the replace flow discards the field directly, never through onChange', () => {
    const onChange = vi.fn();
    const onDiscardField = vi.fn();
    renderMasked(onChange, { onDiscardField });
    fireEvent.click(screen.getByText('com_config_secret_replace'));
    fireEvent.click(screen.getByText('com_ui_cancel'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onDiscardField).toHaveBeenCalledWith('ocr.apiKey');
    expect(screen.getByDisplayValue('sk-mist...4321')).toBeDisabled();
  });

  it('shows the normal input while a reset is pending', () => {
    renderMasked(noop, { pendingResets: new Set(['ocr.apiKey']) });
    expect(screen.queryByDisplayValue('sk-mist...4321')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toBeDisabled();
  });

  it('keeps the reset affordance for a masked db-overridden secret', () => {
    const onResetField = vi.fn();
    renderMasked(noop, {
      dbOverridePaths: new Set(['ocr.apiKey']),
      configuredPaths: new Set(['ocr.apiKey']),
      permissions: { canView: true, canEdit: true, canAssign: false },
      onResetField,
    });
    fireEvent.click(screen.getByText('com_ui_reset'));
    expect(onResetField).toHaveBeenCalledWith('ocr.apiKey');
  });

  it('hides the replace button when the field is disabled', () => {
    renderMasked(noop, { disabled: true });
    expect(screen.getByDisplayValue('sk-mist...4321')).toBeDisabled();
    expect(screen.queryByText('com_config_secret_replace')).not.toBeInTheDocument();
  });

  it('keeps a cleared replacement visible after remount instead of showing the stale mask', () => {
    renderMasked(noop, { editedValues: { 'ocr.apiKey': '' } });
    expect(screen.queryByDisplayValue('sk-mist...4321')).not.toBeInTheDocument();
    const input = screen.getByRole('textbox');
    expect(input).not.toBeDisabled();
    expect(input).toHaveValue('');
  });

  it('does not reopen a cleared replacement once it drops out of editedValues as a baseline match', () => {
    renderMasked(noop, { touchedPaths: new Set(['ocr.apiKey']) });
    expect(screen.getByDisplayValue('sk-mist...4321')).toBeDisabled();
    expect(screen.getByText('com_config_secret_replace')).toBeInTheDocument();
  });

  it('an untyped Replace click does not survive a bumped editSessionId', () => {
    const { rerender } = renderMasked(noop, { editSessionId: 0 });
    fireEvent.click(screen.getByText('com_config_secret_replace'));
    expect(screen.getByRole('textbox')).not.toBeDisabled();

    rerender(
      <FieldRenderer
        fields={secretFields}
        parentValue={maskedParent}
        parentPath="ocr"
        getValue={getValue}
        onChange={noop}
        editSessionId={1}
      />,
    );

    expect(screen.getByDisplayValue('sk-mist...4321')).toBeDisabled();
    expect(screen.getByText('com_config_secret_replace')).toBeInTheDocument();
  });
});

describe('renderInlineField masked secrets (collection entries)', () => {
  const apiKeyField = createField({ key: 'apiKey', type: 'string' });
  const localize = (key: string) => key;

  it('renders a masked display with a Replace flow for a configured array-entry secret', () => {
    const onChange = vi.fn();
    render(
      <>
        {renderInlineField(
          apiKeyField,
          { name: 'first', apiKeyPreview: 'sk-mist...4321' },
          'endpoints.custom.0',
          onChange,
          localize,
        )}
      </>,
    );
    const masked = screen.getByDisplayValue('sk-mist...4321');
    expect(masked).toBeDisabled();
    expect(screen.getByText('com_config_secret_replace')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a normal empty input when the array entry has no preview companion', () => {
    render(
      <>
        {renderInlineField(apiKeyField, { name: 'first' }, 'endpoints.custom.0', vi.fn(), localize)}
      </>,
    );
    expect(screen.getByRole('textbox')).not.toBeDisabled();
    expect(screen.queryByText('com_config_secret_replace')).not.toBeInTheDocument();
  });

  it('cancelling a queued empty-string array-entry replacement clears the field with undefined', () => {
    const onChange = vi.fn();
    render(
      <>
        {renderInlineField(
          apiKeyField,
          { name: 'first', apiKey: '', apiKeyPreview: 'sk-mist...4321' },
          'endpoints.custom.0',
          onChange,
          localize,
        )}
      </>,
    );
    fireEvent.click(screen.getByText('com_ui_cancel'));
    expect(onChange).toHaveBeenCalledWith('apiKey', undefined);
  });

  it('cancelling an untyped array-entry replace never calls onChange, so the entry stays clean', () => {
    const onChange = vi.fn();
    render(
      <>
        {renderInlineField(
          apiKeyField,
          { name: 'first', apiKeyPreview: 'sk-mist...4321' },
          'endpoints.custom.0',
          onChange,
          localize,
        )}
      </>,
    );
    fireEvent.click(screen.getByText('com_config_secret_replace'));
    fireEvent.click(screen.getByText('com_ui_cancel'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps a cleared array-entry replacement visible instead of showing the stale mask', () => {
    render(
      <>
        {renderInlineField(
          apiKeyField,
          { name: 'first', apiKey: '', apiKeyPreview: 'sk-mist...4321' },
          'endpoints.custom.0',
          vi.fn(),
          localize,
        )}
      </>,
    );
    expect(screen.queryByDisplayValue('sk-mist...4321')).not.toBeInTheDocument();
    const input = screen.getByRole('textbox');
    expect(input).not.toBeDisabled();
    expect(input).toHaveValue('');
  });

  it('an untyped array-entry Replace click does not survive a bumped editSessionId', () => {
    const entry = { name: 'first', apiKeyPreview: 'sk-mist...4321' };
    const { rerender } = render(
      <>
        {renderInlineField(
          apiKeyField,
          entry,
          'endpoints.custom.0',
          vi.fn(),
          localize,
          undefined,
          undefined,
          undefined,
          0,
        )}
      </>,
    );
    fireEvent.click(screen.getByText('com_config_secret_replace'));
    expect(screen.getByRole('textbox')).not.toBeDisabled();

    rerender(
      <>
        {renderInlineField(
          apiKeyField,
          entry,
          'endpoints.custom.0',
          vi.fn(),
          localize,
          undefined,
          undefined,
          undefined,
          1,
        )}
      </>,
    );

    expect(screen.getByDisplayValue('sk-mist...4321')).toBeDisabled();
    expect(screen.getByText('com_config_secret_replace')).toBeInTheDocument();
  });

  it('an untyped Replace click inside a nested inline group does not survive a bumped editSessionId', () => {
    const nestedField = createField({ key: 'connection', children: [apiKeyField] });
    const parentValue = { connection: { apiKeyPreview: 'sk-mist...4321' } };
    const { rerender } = render(
      <>
        {renderInlineField(
          nestedField,
          parentValue,
          'endpoints.custom.0',
          vi.fn(),
          localize,
          undefined,
          undefined,
          undefined,
          0,
        )}
      </>,
    );
    fireEvent.click(screen.getByText('com_config_field_connection'));
    fireEvent.click(screen.getByText('com_config_secret_replace'));
    expect(screen.getByRole('textbox')).not.toBeDisabled();

    rerender(
      <>
        {renderInlineField(
          nestedField,
          parentValue,
          'endpoints.custom.0',
          vi.fn(),
          localize,
          undefined,
          undefined,
          undefined,
          1,
        )}
      </>,
    );
    fireEvent.click(screen.getByText('com_config_field_connection'));

    expect(screen.getByDisplayValue('sk-mist...4321')).toBeDisabled();
    expect(screen.getByText('com_config_secret_replace')).toBeInTheDocument();
  });
});

/**
 * Integration flow for array-object collections, wired the same way ConfigPage
 * wires SingleFieldRenderer: edits accumulate through the real applyConfigEdit,
 * indexed edits merge into the baseline through the real mergeIndexedArrayEdits,
 * and getValue resolves pending edits by exact path. Regression coverage for
 * issues #44 and #105, where typing into a newly-added (prepended) entry turned
 * the pending whole-array edit into a bare indexed edit that resolved against
 * the baseline array, overwriting the first existing entry and saving an
 * indexed fieldPath instead of the full array.
 */
function ArrayFlowHarness({
  baselineConfig,
  sectionKey,
  fieldPath,
  onState,
}: {
  baselineConfig: Record<string, t.ConfigValue>;
  sectionKey: string;
  fieldPath: string;
  onState: (state: { editedValues: t.FlatConfigMap; touchedPaths: Set<string> }) => void;
}) {
  const [editedValues, setEditedValues] = useState<t.FlatConfigMap>({});
  const [touchedPaths, setTouchedPaths] = useState<Set<string>>(() => new Set());
  onState({ editedValues, touchedPaths });

  const flatBaseline = useMemo(() => flattenObject(baselineConfig), [baselineConfig]);
  const handleFieldChange = (path: string, value: t.ConfigValue) => {
    setTouchedPaths((prev) => new Set(prev).add(path));
    setEditedValues((prev) =>
      applyConfigEdit(prev, path, value, flatBaseline, new Set(), new Set()),
    );
  };

  const activeConfigValues = useMemo(() => {
    const indexedEdits = Object.entries(editedValues).filter(([k]) => /\.\d+$/.test(k));
    if (indexedEdits.length === 0) return baselineConfig;
    return mergeIndexedArrayEdits(baselineConfig, indexedEdits);
  }, [baselineConfig, editedValues]);

  const getValueWithEdits = (path: string, fallback: t.ConfigValue): t.ConfigValue =>
    path in editedValues ? editedValues[path] : fallback;

  const leafKey = fieldPath.split('.').pop()!;
  const field = createField({
    key: leafKey,
    path: fieldPath,
    type: 'array<object>',
    isArray: true,
    children: [
      createField({ key: 'name', path: `${fieldPath}.name` }),
      createField({ key: 'group', path: `${fieldPath}.group` }),
    ],
  });

  const segments = fieldPath.split('.');
  let sectionValue: t.ConfigValue = activeConfigValues[sectionKey];
  for (const seg of segments.slice(1)) {
    sectionValue =
      sectionValue && typeof sectionValue === 'object' && !Array.isArray(sectionValue)
        ? (sectionValue as Record<string, t.ConfigValue>)[seg]
        : undefined;
  }

  return (
    <SingleFieldRenderer
      field={field}
      value={sectionValue}
      path={fieldPath}
      getValue={getValueWithEdits}
      onChange={handleFieldChange}
      isSoleField={false}
    />
  );
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

describe('array-object add-entry flow (issues #44, #105)', () => {
  it('keeps existing entries when typing into a newly-added entry', () => {
    const state = { editedValues: {} as t.FlatConfigMap, touchedPaths: new Set<string>() };
    const baselineConfig = {
      modelSpecs: {
        list: [
          { name: 'agent-one', group: 'a' },
          { name: 'agent-two', group: 'b' },
        ],
      },
    };
    render(
      <ArrayFlowHarness
        baselineConfig={baselineConfig}
        sectionKey="modelSpecs"
        fieldPath="modelSpecs.list"
        onState={(s) => Object.assign(state, s)}
      />,
    );

    fireEvent.click(screen.getByText('com_ui_add_item'));
    expect(state.editedValues['modelSpecs.list']).toEqual([
      {},
      { name: 'agent-one', group: 'a' },
      { name: 'agent-two', group: 'b' },
    ]);

    const nameInput = document.getElementById('com_config_entry_n-name')!;
    expect(nameInput).not.toBeNull();
    fireEvent.change(nameInput, { target: { value: 'agent-new' } });
    fireEvent.blur(nameInput);

    expect(state.editedValues['modelSpecs.list']).toEqual([
      { name: 'agent-new' },
      { name: 'agent-one', group: 'a' },
      { name: 'agent-two', group: 'b' },
    ]);
    expect(state.editedValues).not.toHaveProperty('modelSpecs.list.0');
    expect(screen.getAllByText('agent-one').length).toBeGreaterThan(0);
    expect(screen.getAllByText('agent-two').length).toBeGreaterThan(0);
    expect(screen.getAllByText('agent-new').length).toBeGreaterThan(0);
  });

  it('saves a new entry in a previously-unset array as the full array path', async () => {
    const state = { editedValues: {} as t.FlatConfigMap, touchedPaths: new Set<string>() };
    const baselineConfig = {
      endpoints: { azureOpenAI: { titleModel: 'gpt-4o-mini' } },
    };
    render(
      <ArrayFlowHarness
        baselineConfig={baselineConfig}
        sectionKey="endpoints"
        fieldPath="endpoints.azureOpenAI.groups"
        onState={(s) => Object.assign(state, s)}
      />,
    );

    fireEvent.click(screen.getByText('com_ui_add_item'));
    await nextFrame();
    await nextFrame();

    const groupInput = document.getElementById('com_config_entry_n-group')!;
    expect(groupInput).not.toBeNull();
    fireEvent.change(groupInput, { target: { value: 'gpt-5.1' } });
    fireEvent.blur(groupInput);

    const { saves } = buildSavePayload(state.touchedPaths, state.editedValues, new Set());
    expect(saves).toEqual([
      { fieldPath: 'endpoints.azureOpenAI.groups', value: [{ group: 'gpt-5.1' }] },
    ]);
    expect(saves.some((s) => /\.\d+$/.test(s.fieldPath))).toBe(false);
  });
});
