import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type * as t from '@/types';
import { SecretField, SecretInput, SecretNotSentNotice } from '../SecretField';
import { RestatesContext } from '@/contexts/RestatesContext';
import { ScalarUnionField } from '../ScalarUnionField';
import { BoolOrListField } from '../BoolOrListField';
import { ModelListField } from '../ModelListField';
import { MultiEnumField } from '../MultiEnumField';
import { TriStateField } from '../TriStateField';
import { TextareaField } from '../TextareaField';
import { LiteralField } from '../LiteralField';
import { createField } from '@/test/fixtures';
import { SelectField } from '../SelectField';
import { NumberField } from '../NumberField';
import { StaticField } from '../StaticField';
import { TextField } from '../TextField';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  useLocalize: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const pressed = (container: HTMLElement) =>
  container.querySelector('[aria-pressed="true"]')?.textContent ?? null;

describe('TriStateField', () => {
  it('shows Default while unset and labels it with the effective value', () => {
    const { container } = render(
      <TriStateField id="t" value={undefined} defaultValue onChange={vi.fn()} aria-label="Title" />,
    );
    expect(pressed(container)).toBe('com_config_ctl_default_value:{"value":"com_config_ctl_on"}');
  });

  it('writes true/false for On/Off and undefined for Default', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TriStateField id="t" value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_on' }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<TriStateField id="t" value onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_off' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(
      screen.getByRole('button', { name: 'com_config_ctl_default_unknown_tristate' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('says LibreChat decides when no default is known, or names who does', () => {
    const { container, rerender } = render(
      <TriStateField id="t" value={undefined} onChange={vi.fn()} />,
    );
    expect(pressed(container)).toBe('com_config_ctl_default_unknown_tristate');
    rerender(
      <TriStateField
        id="t"
        value={undefined}
        onChange={vi.fn()}
        unsetLabel="Not set (Firecrawl decides)"
      />,
    );
    expect(pressed(container)).toBe('Not set (Firecrawl decides)');
  });

  it('names the YAML layer when the default comes from librechat.yaml', () => {
    const { container } = render(
      <TriStateField
        id="t"
        value={undefined}
        defaultValue={false}
        defaultSource="yaml"
        onChange={vi.fn()}
      />,
    );
    expect(pressed(container)).toContain('com_config_ctl_default_yaml');
  });
});

describe('SelectField', () => {
  const options = [
    { value: 'completion', label: 'Completion' },
    { value: 'structured', label: 'Structured' },
  ];

  it('offers a leading Default option that clears the value', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <SelectField
        id="s"
        value="structured"
        options={options}
        onChange={onChange}
        onClear={onClear}
        defaultLabel="Default (Completion)"
      />,
    );
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('structured');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Default (Completion)');
    fireEvent.change(select, {
      target: { value: screen.getAllByRole('option')[0].getAttribute('value') },
    });
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'completion' } });
    expect(onChange).toHaveBeenCalledWith('completion');
  });

  it('is labelled by its <label for> and keeps an unknown value instead of dropping it', () => {
    render(
      <>
        <label htmlFor="s">Title method</label>
        <SelectField id="s" value="legacy" options={options} onChange={vi.fn()} />
      </>,
    );
    const select = screen.getByLabelText('Title method');
    expect(select).toHaveValue('legacy');
    expect(screen.getByRole('option', { name: /legacy/ })).toBeInTheDocument();
  });

  it("offers '' enum members as None", () => {
    render(
      <SelectField
        id="s"
        value=""
        options={[{ value: '', label: '' }, ...options]}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'com_config_ctl_empty_option' })).toBeInTheDocument();
  });
});

describe('TextField clearing', () => {
  it('calls onClear (not onChange with an empty string) when an optional field is cleared', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<TextField id="x" value="gpt-4o" onChange={onChange} onClear={onClear} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('gpt-4o');
  });

  it('explains when the value comes from librechat.yaml and cannot be cleared', () => {
    render(<TextField id="x" value="from-yaml" onChange={vi.fn()} onClear={() => false} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('from-yaml');
    expect(screen.getByRole('status')).toHaveTextContent('com_config_ctl_clear_unavailable');
  });

  it('commits a cleared required field so Save reports it, and says it is required', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<TextField id="x" value="Moonshot" onChange={onChange} onClear={onClear} required />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('');
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('commits while typing after a pause', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<TextField id="x" value="" onChange={onChange} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(onChange).toHaveBeenCalledWith('abc');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('whitespace-only text', () => {
  it('clears an optional text field instead of saving spaces', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<TextField id="x" value="gpt-4o" onChange={onChange} onClear={onClear} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('gpt-4o');
  });

  it('flags a required text field left with only spaces, and never commits the spaces', () => {
    const onChange = vi.fn();
    render(<TextField id="x" value="https://api.moonshot.ai/v1" onChange={onChange} required />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('');
    expect(onChange).not.toHaveBeenCalledWith('   ');
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_required');
  });

  it('does not auto-commit spaces while typing', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<TextField id="x" value="" onChange={onChange} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps leading and trailing whitespace of a non-blank value', () => {
    const onChange = vi.fn();
    render(<TextField id="x" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  Hello  ' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('  Hello  ');
  });

  it('clears a textarea holding only a newline instead of saving "\\n"', () => {
    const onChange = vi.fn();
    const onClear = vi.fn(() => true);
    render(<TextareaField id="w" value="" onChange={onChange} onClear={onClear} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '\n' } });
    fireEvent.blur(textarea);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps whitespace as the value where it is one (a stop sequence)', () => {
    const onChange = vi.fn();
    render(
      <TextareaField id="s" value="STOP" onChange={onChange} onClear={vi.fn()} keepsWhitespace />,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '\n\n' } });
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledWith('\n\n');
  });

  it('never replaces a secret with spaces', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<SecretInput id="k" value="" onChange={onChange} onClear={onClear} aria-label="Key" />);
    const input = screen.getByLabelText('Key');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalledWith('   ');
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('NumberField', () => {
  it('shows the unit and commits out-of-range input with an inline error, so Save can block it', () => {
    const onChange = vi.fn();
    render(<NumberField id="n" value={0.5} onChange={onChange} min={0} max={1} unit="MB" />);
    expect(screen.getByText('com_config_ctl_unit_MB')).toBeInTheDocument();
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('step', '0.01');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(5);
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_number_max');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: '0.85' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(0.85);
  });

  it("leaves the message to the row when the row shows the save pipeline's error", () => {
    const onChange = vi.fn();
    render(<NumberField id="n" value={1} onChange={onChange} min={10} hasRowError />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(-5);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears through onClear', () => {
    const onClear = vi.fn();
    render(<NumberField id="n" value={50} onChange={vi.fn()} onClear={onClear} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('StaticField', () => {
  const field = (key: string, type: string) => createField({ key, type, path: `x.${key}` });

  it('shows values as text: On/Off, option labels, numbers with units and lists as chips', () => {
    const { rerender, container } = render(
      <StaticField id="s" field={field('flag', 'boolean')} kind="tristate" value={false} />,
    );
    expect(container.textContent).toBe('com_config_ctl_off');
    rerender(
      <StaticField id="s" field={field('ttl', 'number')} kind="number" value={60000} unit="ms" />,
    );
    expect(container.textContent).toContain('com_config_unit_ms');
    expect(container.textContent).toContain('60,000');
    rerender(
      <StaticField id="s" field={field('ids', 'array<string>')} kind="array" value={['a', 'b']} />,
    );
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['a', 'b']);
  });

  it('says what applies when unset, never showing an empty input', () => {
    const { container, rerender } = render(
      <StaticField id="s" field={field('flag', 'boolean')} kind="tristate" value={undefined} />,
    );
    expect(container.textContent).toBe('com_config_values_not_set');
    expect(container.querySelector('input')).toBeNull();
    rerender(
      <StaticField
        id="s"
        field={field('flag', 'boolean')}
        kind="tristate"
        value={undefined}
        fallback
      />,
    );
    expect(container.textContent).toContain('com_config_ctl_default_value');
  });

  it('masks secrets but shows environment references and stored previews', () => {
    const { container, rerender } = render(
      <StaticField id="s" field={field('apiKey', 'string')} kind="secret" value="sk-live-123" />,
    );
    expect(container.textContent).not.toContain('sk-live');
    rerender(<StaticField id="s" field={field('apiKey', 'string')} kind="secret" value="${KEY}" />);
    expect(container.textContent).toBe('${KEY}');
    rerender(
      <StaticField
        id="s"
        field={field('apiKey', 'string')}
        kind="secret"
        value={undefined}
        secretPreview="sk-li...123"
      />,
    );
    expect(container.textContent).toBe('sk-li...123');
    rerender(
      <StaticField
        id="s"
        field={field('apiKey', 'string')}
        kind="secret"
        value={undefined}
        secretPreview="********"
        secretMaskLabel="Set in librechat.yaml (hidden)"
      />,
    );
    expect(container.textContent).toBe('Set in librechat.yaml (hidden)');
  });
});

describe('SecretField', () => {
  it('reads the fixed mask as where the key is set, and a stored preview as itself', () => {
    const props = { id: 'k', value: '', onChange: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<SecretField {...props} maskedValue="********" />);
    expect(screen.getByDisplayValue('com_config_secret_hidden')).toBeInTheDocument();
    rerender(<SecretField {...props} maskedValue="********" maskLabel="From librechat.yaml" />);
    expect(screen.getByDisplayValue('From librechat.yaml')).toBeInTheDocument();
    rerender(<SecretField {...props} maskedValue="sk-...1234" maskLabel="From librechat.yaml" />);
    expect(screen.getByDisplayValue('sk-...1234')).toBeInTheDocument();
  });
});

describe('SecretNotSentNotice', () => {
  const credential: t.MovedCredential = {
    path: 'endpoints.custom',
    entry: 'Moonshot',
    secret: 'apiKey',
    moved: ['baseURL'],
    restatable: '${MS_KEY}',
    restated: false,
  };
  const ref = { path: 'endpoints.custom', entry: 'Moonshot', secret: 'apiKey' };

  it('offers to send a readable inherited credential there too, and to take that back', () => {
    const onRestate = vi.fn();
    const { rerender } = render(
      <RestatesContext.Provider value={{ restates: {}, onRestate }}>
        <SecretNotSentNotice credential={credential} fields="Base URL" />
      </RestatesContext.Provider>,
    );
    expect(
      screen.getByText(
        'com_config_secret_not_sent_restatable:{"fields":"Base URL","value":"${MS_KEY}"}',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_secret_restate' }));
    expect(onRestate).toHaveBeenCalledWith(ref, true);
    rerender(
      <RestatesContext.Provider value={{ restates: {}, onRestate }}>
        <SecretNotSentNotice credential={{ ...credential, restated: true }} fields="Base URL" />
      </RestatesContext.Provider>,
    );
    expect(
      screen.getByText('com_config_secret_restated:{"value":"${MS_KEY}"}'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_secret_restate_undo' }));
    expect(onRestate).toHaveBeenLastCalledWith(ref, false);
  });

  it('asks for a credential where none can be restated: hidden, read-only, or no handler', () => {
    const hidden = { ...credential, restatable: undefined };
    const { rerender } = render(<SecretNotSentNotice credential={credential} fields="Base URL" />);
    expect(
      screen.getByText('com_config_secret_not_sent:{"fields":"Base URL"}'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    for (const props of [
      { credential: hidden, fields: 'Base URL' },
      { credential, fields: 'Base URL', disabled: true },
    ]) {
      rerender(
        <RestatesContext.Provider value={{ restates: {}, onRestate: vi.fn() }}>
          <SecretNotSentNotice {...props} />
        </RestatesContext.Provider>,
      );
      expect(screen.queryByRole('button')).toBeNull();
    }
  });
});

describe('BoolOrListField', () => {
  it('round-trips true/false/list and keeps "Only these" local until it has an item', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const { container, rerender } = render(
      <BoolOrListField id="b" value onChange={onChange} onClear={onClear} />,
    );
    expect(pressed(container)).toBe('com_config_ctl_bool_list_all');
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_bool_list_some' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(pressed(container)).toBe('com_config_ctl_bool_list_some');
    rerender(<BoolOrListField id="b" value={['skill-a']} onChange={onChange} onClear={onClear} />);
    expect(screen.getByDisplayValue('skill-a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_off' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_default' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('ScalarUnionField', () => {
  it('shows a number for number|string and saves numbers', () => {
    const onChange = vi.fn();
    render(
      <ScalarUnionField id="u" value={200000} kinds={['number', 'string']} onChange={onChange} />,
    );
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(200000);
    fireEvent.change(input, { target: { value: '100000' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(100000);
  });

  it('maps boolean|enum to one select with Off/On', () => {
    const onChange = vi.fn();
    render(
      <ScalarUnionField
        id="u"
        value={false}
        kinds={['boolean']}
        options={[{ value: 'basic', label: 'Basic' }]}
        onChange={onChange}
        onClear={vi.fn()}
      />,
    );
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('false');
    fireEvent.change(select, { target: { value: 'true' } });
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(select, { target: { value: 'basic' } });
    expect(onChange).toHaveBeenLastCalledWith('basic');
  });

  it('shows `true` of string|boolean as On instead of an empty text box', () => {
    const { container } = render(
      <ScalarUnionField id="u" value kinds={['string', 'boolean']} onChange={vi.fn()} />,
    );
    expect(pressed(container)).toBe('com_config_ctl_on');
  });
});

describe('LiteralField', () => {
  it('sets the literal or removes it', () => {
    const onChange = vi.fn();
    render(<LiteralField id="l" literal="anthropic" value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith('anthropic');
  });

  it('flags a value other than the literal', () => {
    render(<LiteralField id="l" literal="anthropic" value="openai" onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_ctl_literal_invalid');
  });
});

describe('MultiEnumField', () => {
  const options = [
    { value: 'tools', label: 'Tools' },
    { value: 'chain', label: 'Chain' },
  ];

  it('toggles values without duplicates and keeps unknown values', () => {
    const onChange = vi.fn();
    render(
      <MultiEnumField id="m" value={['legacy', 'tools']} options={options} onChange={onChange} />,
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chain' }));
    expect(onChange).toHaveBeenLastCalledWith(['legacy', 'tools', 'chain']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tools' }));
    expect(onChange).toHaveBeenLastCalledWith(['legacy']);
  });
});

describe('ModelListField', () => {
  const items: t.ConfigValue = [{ name: 'kimi-k2.5', description: 'Flagship' }, 'kimi-latest'];

  it('round-trips object items and never stringifies them', () => {
    const onChange = vi.fn();
    render(<ModelListField id="m" value={items} onChange={onChange} onClear={vi.fn()} required />);
    expect(screen.getByText('kimi-k2.5')).toBeInTheDocument();
    expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'com_config_ctl_models_add' });
    fireEvent.change(input, { target: { value: 'kimi-k2-thinking' } });
    expect(fireEvent.keyDown(input, { key: 'Enter' }), 'Enter that adds never submits').toBe(false);
    expect(onChange).toHaveBeenLastCalledWith([
      { name: 'kimi-k2.5', description: 'Flagship' },
      'kimi-latest',
      'kimi-k2-thinking',
    ]);
  });

  it('splits pasted lists, trims and de-duplicates', () => {
    const onChange = vi.fn();
    render(<ModelListField id="m" value={['a']} onChange={onChange} onClear={vi.fn()} required />);
    const input = screen.getByRole('textbox', { name: 'com_config_ctl_models_add' });
    fireEvent.paste(input, { clipboardData: { getData: () => ' b ,a\nc\n\nb' } });
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b', 'c']);
  });

  it('resets the field instead of saving [] when the last model is removed', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<ModelListField id="m" value={['only']} onChange={onChange} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: /com_ui_remove_item/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('starts in provider-default mode and can start from the defaults', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ModelListField
        id="m"
        value={undefined}
        defaults={['x', 'y']}
        onChange={onChange}
        onClear={vi.fn()}
      />,
    );
    expect(pressed(container)).toBe('com_config_ctl_models_defaults');
    fireEvent.click(
      screen.getByRole('button', { name: 'com_config_ctl_models_start_from_defaults' }),
    );
    expect(onChange).toHaveBeenCalledWith(['x', 'y']);
  });
});
