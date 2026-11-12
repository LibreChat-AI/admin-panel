import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type * as t from '@/types';
import { ConfigTabContent } from '../ConfigTabContent';
import '@/locales/i18n';

/** One section the tab could show; the filter or "Set values only" hides it. */
const SECTIONS: t.ConfigSectionConfig[] = [
  {
    id: 'interface',
    titleKey: 'com_config_section_interface',
    fields: [
      {
        key: 'customWelcome',
        path: 'interface.customWelcome',
        type: 'string',
        isOptional: true,
        depth: 1,
      },
    ],
  },
];

function Tab(props: Partial<t.ConfigTabContentProps>) {
  return (
    <ConfigTabContent
      sections={SECTIONS}
      configValues={{}}
      editedValues={{}}
      onFieldChange={vi.fn()}
      {...props}
    />
  );
}

async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

describe('ConfigTabContent empty states', () => {
  it('announces that the filter matches no setting from a status region that was there before', async () => {
    const { rerender } = render(<Tab />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    rerender(<Tab visibleSectionIds={new Set()} filterText="zzzzxx" onClearFilter={vi.fn()} />);
    await nextFrame();
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('No settings on this tab match “zzzzxx”');
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeVisible();

    rerender(<Tab />);
    await nextFrame();
    expect(status).toBeEmptyDOMElement();
  });

  it('announces that "Set values only" leaves nothing on the tab from a status region that was there before', async () => {
    const { rerender } = render(<Tab />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    rerender(<Tab showConfiguredOnly />);
    await nextFrame();
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Nothing is set on this tab');
  });
});
