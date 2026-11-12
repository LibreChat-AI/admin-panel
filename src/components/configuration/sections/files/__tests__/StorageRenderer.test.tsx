import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderSections, tabSections } from '@/test/sections';

const STORAGE = ['fileStrategy', 'fileStrategies', 'cloudfront'];

describe('StorageRenderer', () => {
  it('renders the three storage sections as one Storage card', () => {
    renderSections({ sections: STORAGE });
    expect(screen.getByRole('heading', { level: 2, name: /Storage/ })).toHaveTextContent(
      /0 of 6 set/,
    );
    expect(screen.getByRole('heading', { level: 2, name: /Storage/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByLabelText('Storage backend')).toHaveDisplayValue(
      'Default (Local filesystem)',
    );
    expect(screen.getByText(/No setup needed/)).toBeInTheDocument();
    expect(screen.getByText(/CloudFront isn't in use/)).toBeInTheDocument();
  });

  it('lists a file type a newer schema adds, and per-type keys no schema knows', () => {
    const avatar = tabSections(['fileStrategies'])[0].fields.find((f) => f.key === 'avatar')!;
    renderSections({
      sections: STORAGE,
      yaml: { fileStrategies: { video: 's3', legacy: 'local' } },
      extraFields: {
        fileStrategies: [{ ...avatar, key: 'video', path: 'fileStrategies.video' }],
      },
    });
    const group = document.getElementById('section-fileStrategies')!.closest('section')!;
    expect(within(group).getByLabelText(/video/i)).toBeInTheDocument();
    expect(within(group).getByText('legacy')).toBeInTheDocument();
  });

  it('confirms a backend change with what it needs before staging it', () => {
    const onChange = vi.fn();
    renderSections({ sections: STORAGE, onChange });
    fireEvent.change(screen.getByLabelText('Storage backend'), { target: { value: 's3' } });
    const dialog = screen.getByRole('dialog', { name: 'Switch file storage to Amazon S3?' });
    expect(within(dialog).getByText('AWS_BUCKET_NAME')).toBeInTheDocument();
    expect(within(dialog).getByText(/stay in Local filesystem/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Storage backend')).toHaveDisplayValue(
      'Default (Local filesystem)',
    );

    fireEvent.change(screen.getByLabelText('Storage backend'), { target: { value: 's3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Amazon S3' }));
    expect(onChange).toHaveBeenCalledWith('fileStrategy', 's3');
    expect(screen.getByLabelText('Storage backend')).toHaveDisplayValue('Amazon S3');
  });

  it('names what each file type inherits, as getFileStrategy resolves it', () => {
    renderSections({
      sections: STORAGE,
      yaml: { fileStrategy: 's3', fileStrategies: { image: 'firebase' } },
    });
    expect(screen.getByLabelText('Profile pictures')).toHaveDisplayValue('Inherit (Amazon S3)');
    expect(screen.getByLabelText('Images')).toHaveDisplayValue('librechat.yaml (Firebase Storage)');
    expect(screen.getByLabelText('Skill files')).toHaveDisplayValue(
      'By file type (images: Firebase Storage, documents: Amazon S3)',
    );
  });

  it('keeps a backend a newer LibreChat accepts, shown by its name', () => {
    const onChange = vi.fn();
    renderSections({
      sections: STORAGE,
      yaml: { fileStrategies: { image: 'gcs' } },
      overrides: { fileStrategies: { document: 'gcs' } },
      onChange,
    });
    expect(screen.getByLabelText('Images')).toHaveDisplayValue('librechat.yaml (gcs)');
    expect(screen.getByLabelText('Documents')).toHaveDisplayValue('gcs');
    expect(screen.getByLabelText('Profile pictures')).toHaveDisplayValue(
      'Inherit (Local filesystem)',
    );
    fireEvent.change(screen.getByLabelText('Documents'), { target: { value: 's3' } });
    const dialog = screen.getByRole('dialog', { name: /Amazon S3/ });
    expect(within(dialog).getByText(/stay in gcs/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('confirms a skill files choice that moves them off the image and document backends they follow', () => {
    const onChange = vi.fn();
    renderSections({
      sections: STORAGE,
      yaml: { fileStrategy: 'local', fileStrategies: { image: 's3', document: 'azure_blob' } },
      onChange,
    });
    fireEvent.change(screen.getByLabelText('Skill files'), { target: { value: 'local' } });
    const dialog = screen.getByRole('dialog', { name: 'Store skill files in Local filesystem?' });
    expect(
      within(dialog).getByText(/stay in Amazon S3 \(images\) and Azure Blob Storage \(documents\)/),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch to Local filesystem' }));
    expect(onChange).toHaveBeenCalledWith('fileStrategies.skills', 'local');
  });

  it('confirms moving skill files off the one backend images and documents share', () => {
    const onChange = vi.fn();
    renderSections({
      sections: STORAGE,
      yaml: { fileStrategy: 'local', fileStrategies: { image: 's3', document: 's3' } },
      onChange,
    });
    fireEvent.change(screen.getByLabelText('Skill files'), { target: { value: 's3' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith('fileStrategies.skills', 's3');
    fireEvent.change(screen.getByLabelText('Skill files'), { target: { value: 'local' } });
    expect(
      screen.getByRole('dialog', { name: 'Store skill files in Local filesystem?' }),
    ).toBeInTheDocument();
  });

  it('warns when the per-type default takes precedence over the backend', () => {
    renderSections({ sections: STORAGE, yaml: { fileStrategies: { default: 'azure_blob' } } });
    expect(screen.getByText(/takes precedence over this setting/)).toBeInTheDocument();
  });

  it('says when CloudFront is selected but librechat.yaml never set it up', () => {
    renderSections({ sections: STORAGE, yaml: { fileStrategies: { image: 'cloudfront' } } });
    expect(screen.getByRole('alert')).toHaveTextContent(/uploads to it fail/);
    expect(screen.getByRole('heading', { level: 2, name: /Storage/ })).toHaveTextContent(
      /of 16 set/,
    );
  });

  it('only offers CloudFront once librechat.yaml set it up', () => {
    const { unmount } = renderSections({ sections: STORAGE });
    const option = within(screen.getByLabelText('Storage backend')).getByRole('option', {
      name: /^Amazon CloudFront \(S3\): set up in librechat.yaml first$/,
    });
    expect(option).toBeDisabled();
    unmount();

    renderSections({
      sections: STORAGE,
      yaml: { fileStrategy: 'cloudfront', cloudfront: { domain: 'https://cdn.example.com' } },
    });
    expect(
      within(screen.getByLabelText('Storage backend')).getByRole('option', {
        name: 'Amazon CloudFront (S3)',
      }),
    ).not.toBeDisabled();
    expect(screen.getByText(/values saved in the admin panel are never applied/i)).toBeVisible();
  });
});
