import { describe, it, expect } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { sectionFields, renderSection } from './harness';
import { InterfaceRenderer } from '../Interface';
import { INTERFACE_GROUPS } from '@/constants';
import '@/locales/i18n';

/** Group titles, without the count badge ("Retention, 0 of 4 set"). */
const groupHeadings = () =>
  screen
    .getAllByRole('heading', { level: 3 })
    .map((heading) => (heading.textContent ?? '').replace(/,?\s*\d+ of \d+ set$/, '').trim());

describe('InterfaceRenderer', () => {
  it('groups the settings by purpose, in order', () => {
    renderSection(InterfaceRenderer, { section: 'interface' });
    expect(groupHeadings()).toEqual([
      'Chat controls',
      'Appearance',
      'Onboarding & legal',
      'Retention',
      'Sharing',
      'Scheduling',
      'Reply notifications',
      'Trace viewer',
      'MCP menu',
      'Timing and caching',
    ]);
  });

  it('lists every interface setting in some group', () => {
    const grouped = new Set(INTERFACE_GROUPS.flatMap((group) => group.fields));
    const ungrouped = sectionFields('interface').filter((field) => !grouped.has(field.key));
    expect(ungrouped.map((field) => field.key)).toEqual([]);
  });

  it('shows the privacy policy URL before its new-tab switch, and the terms before acceptance', () => {
    renderSection(InterfaceRenderer, { section: 'interface' });
    const labels = Array.from(document.querySelectorAll('label.settings-label')).map(
      (label) => label.textContent,
    );
    const at = (text: string) => labels.indexOf(text);
    expect(at('Privacy policy URL')).toBeLessThan(at('Open privacy policy in a new tab'));
    expect(at('Terms of service URL')).toBeLessThan(at('Terms dialog title'));
    expect(at('Terms dialog content')).toBeLessThan(at('Require acceptance'));
    expect(at('Retention mode')).toBeLessThan(at('Temporary chat retention'));
  });

  it('keeps the table-of-contents anchors of the objects it shows flat', () => {
    renderSection(InterfaceRenderer, { section: 'interface' });
    for (const key of ['privacyPolicy', 'termsOfService', 'traceViewer', 'mcpServers']) {
      expect(document.getElementById(`section-interface.${key}`), key).not.toBeNull();
    }
  });

  it('shows only the groups holding a tab-filter match', () => {
    renderSection(InterfaceRenderer, {
      section: 'interface',
      filter: ['interface.retentionMode'],
    });
    expect(groupHeadings()).toEqual(['Retention']);
  });

  it('keeps the group (and flat object) of a pending edit under "Set values only"', () => {
    renderSection(InterfaceRenderer, {
      section: 'interface',
      edited: {
        'interface.retentionMode': 'all',
        'interface.privacyPolicy.externalUrl': 'https://example.com/privacy',
      },
      props: { showConfiguredOnly: true },
    });
    expect(groupHeadings()).toEqual(['Onboarding & legal', 'Retention']);
    expect(screen.getByLabelText('Privacy policy URL')).toHaveValue('https://example.com/privacy');
  });

  it('marks a group as set when librechat.yaml sets one of its settings', () => {
    renderSection(InterfaceRenderer, {
      section: 'interface',
      yaml: { interface: { modelSelect: true, traceViewer: { enabled: true } } },
    });
    const trace = screen.getByRole('heading', { name: /^Trace viewer/ });
    expect(trace).toHaveTextContent(/1 of 7 set/);
  });

  it('asks before requiring acceptance of the terms, since it also gates the admin', () => {
    const { onChange } = renderSection(InterfaceRenderer, { section: 'interface' });
    const control = document.getElementById('interface-termsOfService-modalAcceptance');
    if (!control) throw new Error('no Require acceptance control');
    fireEvent.click(within(control).getByRole('button', { name: 'On' }));
    const dialog = screen.getByRole('dialog', { name: 'Require everyone to accept the terms?' });
    expect(dialog).toHaveTextContent(/This includes you and other admins/);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Require acceptance' }));
    expect(onChange).toHaveBeenCalledWith('interface.termsOfService.modalAcceptance', true);
  });
});
