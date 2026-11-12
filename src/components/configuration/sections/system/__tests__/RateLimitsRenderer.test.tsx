import '@/locales/i18n';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderSection, sectionFields } from '../../features/__tests__/harness';
import { RateLimitsRenderer } from '../RateLimitsRenderer';
import { renderSections } from '@/test/sections';

describe('RateLimitsRenderer', () => {
  it('lists every limiter with librechat.yaml values or LibreChat defaults, read-only', () => {
    renderSections({
      sections: ['rateLimits'],
      yaml: { rateLimits: { fileUploads: { userMax: 20, userWindowInMinutes: 5 } } },
    });
    const table = screen.getByRole('table', { name: 'Rate limits' });
    const uploads = within(table).getByRole('row', { name: /File uploads/ });
    expect(uploads).toHaveTextContent('100 requests / 15 min');
    expect(uploads).toHaveTextContent('20 requests / 5 min');
    expect(within(uploads).getByText('librechat.yaml')).toBeInTheDocument();
    const agents = within(table).getByRole('row', { name: /Agent events/ });
    expect(agents).toHaveTextContent('Not limited');
    expect(agents).toHaveTextContent('40 requests / 1 min');
    expect(screen.getByText(/never applied, even after a restart/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('in a profile, shows librechat.yaml values and defaults, never a stale Base override', () => {
    renderSections({
      sections: ['rateLimits'],
      yaml: { rateLimits: { fileUploads: { userMax: 20 } } },
      overrides: { rateLimits: { fileUploads: { ipMax: 999, userWindowInMinutes: 77 } } },
      profile: { balance: { enabled: true } },
    });
    const uploads = within(screen.getByRole('table', { name: 'Rate limits' })).getByRole('row', {
      name: /File uploads/,
    });
    expect(uploads).toHaveTextContent('100 requests / 15 min');
    expect(uploads).toHaveTextContent('20 requests / 15 min');
    expect(uploads).not.toHaveTextContent('999');
    expect(uploads).not.toHaveTextContent('77');
    expect(within(uploads).getByText('Default')).toBeInTheDocument();
    const stt = within(screen.getByRole('table', { name: 'Rate limits' })).getByRole('row', {
      name: /Speech to text/,
    });
    expect(within(stt).queryByText(/librechat\.yaml/)).not.toBeInTheDocument();
  });

  it('with "Set values only", lists only the limiters librechat.yaml sets', () => {
    renderSections({
      sections: ['rateLimits'],
      yaml: { rateLimits: { fileUploads: { userMax: 20 } } },
      showConfiguredOnly: true,
    });
    const table = screen.getByRole('table', { name: 'Rate limits' });
    expect(within(table).getByRole('row', { name: /File uploads/ })).toBeInTheDocument();
    expect(within(table).queryByRole('row', { name: /Agent events/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole('row', { name: /Speech to text/ })).not.toBeInTheDocument();
  });

  it('lists schema content the table does not place as read-only rows', () => {
    const fields = sectionFields('rateLimits');
    const uploads = fields.find((field) => field.key === 'fileUploads')!;
    const burst = { ...uploads.children![0], key: 'burst', path: 'rateLimits.fileUploads.burst' };
    const imports = {
      ...uploads,
      key: 'bulkImports',
      path: 'rateLimits.bulkImports',
      children: uploads.children!.map((child) => ({
        ...child,
        path: `rateLimits.bulkImports.${child.key}`,
      })),
    };
    renderSection(RateLimitsRenderer, {
      section: 'rateLimits',
      yaml: { rateLimits: { bulkImports: { userMax: 7 }, fileUploads: { burst: 4 } } },
      props: {
        fields: [
          ...fields.filter((field) => field.key !== 'fileUploads'),
          { ...uploads, children: [...(uploads.children ?? []), burst] },
          imports,
        ],
      },
    });
    expect(document.getElementById('rateLimits-fileUploads-burst')).toHaveTextContent('4');
    expect(document.getElementById('rateLimits-bulkImports-userMax')).toHaveTextContent('7');
    expect(document.getElementById('rateLimits-fileUploads-userMax')).not.toBeNull();
  });

  it('says which number librechat.yaml sets when it sets only one of the pair', () => {
    renderSections({
      sections: ['rateLimits'],
      yaml: { rateLimits: { fileUploads: { userMax: 20, ipWindowInMinutes: 30 } } },
    });
    const uploads = within(screen.getByRole('table', { name: 'Rate limits' })).getByRole('row', {
      name: /File uploads/,
    });
    expect(uploads).toHaveTextContent('100 requests / 30 min');
    expect(uploads).toHaveTextContent('20 requests / 15 min');
    expect(within(uploads).getByText('Window from librechat.yaml, requests default')).toBeVisible();
    expect(within(uploads).getByText('Requests from librechat.yaml, window default')).toBeVisible();
    expect(within(uploads).queryByText('librechat.yaml')).not.toBeInTheDocument();
  });
});
