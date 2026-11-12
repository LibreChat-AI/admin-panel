import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SummarizationRenderer } from '../Summarization';
import { renderSection } from './harness';
import '@/locales/i18n';

const typeSelect = () => screen.getByLabelText('Trigger: when to summarize');

describe('SummarizationRenderer: trigger', () => {
  it('explains the default: summarize when older messages no longer fit', () => {
    renderSection(SummarizationRenderer, { section: 'summarization' });
    expect(typeSelect()).toHaveDisplayValue('Default (when context is full)');
    expect(screen.getByText(/whenever older messages would otherwise be dropped/)).toBeVisible();
    expect(screen.queryByLabelText('Trigger: value')).not.toBeInTheDocument();
  });

  it('choosing a type writes it with a typical numeric value, never a string', () => {
    const { onChange } = renderSection(SummarizationRenderer, { section: 'summarization' });
    fireEvent.change(typeSelect(), { target: { value: 'token_ratio' } });
    expect(onChange).toHaveBeenLastCalledWith('summarization.trigger', {
      type: 'token_ratio',
      value: 0.8,
    });
    expect(screen.getByLabelText('Trigger: value')).toHaveValue(0.8);
    expect(
      screen.getByText("Summarizes once 80% of the model's context window is used."),
    ).toBeVisible();
  });

  it('switching the type keeps the trigger whole and suggests a value in the new range', () => {
    const { onChange } = renderSection(SummarizationRenderer, {
      section: 'summarization',
      overrides: { summarization: { trigger: { type: 'token_ratio', value: 0.5 } } },
    });
    fireEvent.change(typeSelect(), { target: { value: 'messages_to_refine' } });
    expect(onChange).toHaveBeenLastCalledWith('summarization.trigger', {
      type: 'messages_to_refine',
      value: 20,
    });
  });

  it('flags a value outside the type range', () => {
    renderSection(SummarizationRenderer, {
      section: 'summarization',
      overrides: { summarization: { trigger: { type: 'token_ratio', value: 0.5 } } },
    });
    const value = screen.getByLabelText('Trigger: value');
    fireEvent.change(value, { target: { value: '1.5' } });
    fireEvent.blur(value);
    expect(screen.getByRole('alert')).toHaveTextContent('1');
  });

  it('Default removes the own trigger', () => {
    const { onChange } = renderSection(SummarizationRenderer, {
      section: 'summarization',
      overrides: { summarization: { trigger: { type: 'token_ratio', value: 0.5 } } },
    });
    fireEvent.change(typeSelect(), { target: { value: '\u0000default' } });
    expect(onChange).toHaveBeenLastCalledWith('summarization.trigger', undefined);
  });
});
