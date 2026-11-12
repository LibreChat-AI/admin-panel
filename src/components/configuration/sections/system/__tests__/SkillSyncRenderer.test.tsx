import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderSections } from '@/test/sections';

describe('SkillSyncRenderer', () => {
  it('shows sources as owner/repo cards with their branch and folders', () => {
    renderSections({
      sections: ['skillSync'],
      yaml: {
        skillSync: {
          github: {
            enabled: true,
            sources: [{ id: 'team', owner: 'acme', repo: 'skills', ref: 'v2', paths: ['a', 'b'] }],
          },
        },
      },
    });
    expect(screen.getByText('acme/skills')).toBeInTheDocument();
    expect(screen.getByText('v2 · 2 folders')).toBeInTheDocument();
  });

  it('with "Set values only", leaves out sources nothing sets', () => {
    renderSections({
      sections: ['skillSync'],
      yaml: { skillSync: { github: { enabled: true } } },
      showConfiguredOnly: true,
    });
    expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No sources yet/)).not.toBeInTheDocument();
  });

  it('lists a GitHub setting the schema does not know inside the GitHub group', () => {
    renderSections({
      sections: ['skillSync'],
      yaml: { skillSync: { github: { enabled: true, mirrorUrl: 'https://ghe.example' } } },
    });
    const group = document.getElementById('section-skillSync.github')!.closest('section')!;
    expect(within(group).getByText('mirrorUrl')).toBeInTheDocument();
    expect(within(group).getByText('https://ghe.example')).toBeInTheDocument();
  });

  it('adds a source from the group header', () => {
    const onChange = vi.fn();
    renderSections({ sections: ['skillSync'], onChange });
    expect(screen.getByText(/No sources yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    expect(onChange).toHaveBeenCalledWith('skillSync.github.sources', [{}]);
  });
});
