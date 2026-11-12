import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderSections } from '@/test/sections';

const SECTIONS = ['balance', 'transactions'];
const YAML = {
  balance: {
    enabled: true,
    startBalance: 1000000,
    autoRefillEnabled: true,
    refillIntervalValue: 4,
    refillIntervalUnit: 'hours',
    refillAmount: 1000000,
  },
};

describe('CreditsRenderer', () => {
  it('renders balance and transactions as one card with credits and dollars', () => {
    renderSections({ sections: SECTIONS, yaml: YAML });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: /Balance & credits/ })).toBeVisible();
    expect(screen.getByLabelText('Starting credits')).toHaveValue('1,000,000');
    expect(screen.getByText('Worth about $1.00 of model usage')).toBeInTheDocument();
    expect(screen.getByLabelText('Credits per refill')).toHaveValue('1,000,000');
    expect(screen.getByLabelText('Refill interval')).toHaveValue(4);
    expect(screen.getByLabelText('Refill interval unit')).toHaveDisplayValue('hours');
  });

  it('reads separators in typed credits and stages the number', async () => {
    const onChange = vi.fn();
    renderSections({ sections: SECTIONS, yaml: YAML, onChange });
    const input = screen.getByLabelText('Starting credits');
    fireEvent.change(input, { target: { value: '2,500,000' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(onChange).toHaveBeenCalledWith('balance.startBalance', 2500000);
    fireEvent.change(input, { target: { value: '12abc' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('whole number of credits');
  });

  it('shows the refill sentence only while auto-refill is on', () => {
    renderSections({
      sections: SECTIONS,
      yaml: { balance: { ...YAML.balance, autoRefillEnabled: false } },
    });
    expect(screen.queryByLabelText('Credits per refill')).not.toBeInTheDocument();
    expect(screen.getByText(/Turn on auto-refill/)).toBeInTheDocument();
  });

  it('lists balance and transactions settings it does not place, so none is hidden', () => {
    renderSections({
      sections: SECTIONS,
      yaml: {
        balance: { ...YAML.balance, refillCap: 5000000 },
        transactions: { enabled: true, retentionDays: 30 },
      },
    });
    expect(screen.getByText('refillCap')).toBeInTheDocument();
    expect(screen.getByText('retentionDays')).toBeInTheDocument();
  });

  it('warns while balance needs transactions that are turned off', () => {
    renderSections({ sections: SECTIONS, yaml: { ...YAML, transactions: { enabled: false } } });
    expect(screen.getByText(/LibreChat keeps recording them/)).toBeInTheDocument();
  });
});
