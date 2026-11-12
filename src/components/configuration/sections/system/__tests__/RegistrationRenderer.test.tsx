import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { createServerContract } from '@/test/fixtures';
import { renderSections } from '@/test/sections';

const YAML = {
  registration: {
    socialLogins: ['openid', 'google'],
    allowedDomains: ['gmail.com', 'example.com'],
  },
};

function addDomain(text: string) {
  const input = screen.getByRole('textbox', { name: 'Add a domain' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('RegistrationRenderer', () => {
  it('shows social sign-in providers by name, read-only', () => {
    renderSections({ sections: ['registration'], yaml: YAML });
    expect(screen.getByText('OpenID Connect')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText(/reads this list from librechat.yaml only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove openid/i })).not.toBeInTheDocument();
  });

  it('edits the providers in Base once Base overrides apply before sign-in', () => {
    const onChange = vi.fn();
    renderSections({
      sections: ['registration'],
      yaml: YAML,
      onChange,
      contract: createServerContract({ preAuthBaseOverrides: true }),
    });
    expect(screen.queryByText(/reads this list from librechat.yaml only/)).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: /Add sign-in option/ }), {
      target: { value: 'github' },
    });
    expect(onChange).toHaveBeenLastCalledWith('registration.socialLogins', [
      'openid',
      'google',
      'github',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Google' }));
    expect(onChange).toHaveBeenLastCalledWith('registration.socialLogins', ['openid', 'github']);
    expect(
      screen.getByText('Social, SSO and LDAP sign-ins and password resets check this list too.'),
    ).toBeInTheDocument();
  });

  it('removes the Base list when it matches librechat.yaml again', () => {
    const onChange = vi.fn();
    renderSections({
      sections: ['registration'],
      yaml: YAML,
      overrides: { registration: { socialLogins: ['openid'] } },
      onChange,
      contract: createServerContract({ preAuthBaseOverrides: true }),
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Add sign-in option/ }), {
      target: { value: 'google' },
    });
    expect(onChange).toHaveBeenLastCalledWith('registration.socialLogins', undefined);
  });

  it('in a profile, lists the librechat.yaml providers, not a stale Base override', () => {
    renderSections({
      sections: ['registration'],
      yaml: YAML,
      overrides: { registration: { socialLogins: ['github'] } },
      profile: { registration: { allowedDomains: ['example.com'] } },
    });
    expect(screen.getByText('OpenID Connect')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
  });

  it("lists LibreChat's default providers when librechat.yaml sets none", () => {
    renderSections({
      sections: ['registration'],
      overrides: { registration: { socialLogins: ['github'] } },
      profile: { registration: { allowedDomains: ['example.com'] } },
    });
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Discord')).toBeInTheDocument();
  });

  it('adds domains as chips, normalized and validated', () => {
    const onChange = vi.fn();
    renderSections({ sections: ['registration'], yaml: YAML, onChange });
    addDomain('not a domain');
    expect(screen.getByRole('alert')).toHaveTextContent("isn't a domain");
    addDomain('gmail.com');
    expect(screen.getByRole('alert')).toHaveTextContent('already in the list');
    expect(onChange).not.toHaveBeenCalled();
    addDomain(' @LibreChat.AI ');
    expect(onChange).toHaveBeenCalledWith('registration.allowedDomains', [
      'gmail.com',
      'example.com',
      'librechat.ai',
    ]);
    expect(screen.getByText('Sign-up is limited to 3 domains.')).toBeInTheDocument();
  });

  it('asks before an empty list lets anyone sign up, then stores the empty list', () => {
    const onChange = vi.fn();
    renderSections({ sections: ['registration'], yaml: YAML, onChange });
    fireEvent.click(screen.getByRole('button', { name: 'Remove gmail.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove example.com' }));
    const dialog = screen.getByRole('dialog', { name: 'Let anyone sign up?' });
    expect(onChange).toHaveBeenLastCalledWith('registration.allowedDomains', ['example.com']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Let anyone sign up' }));
    expect(onChange).toHaveBeenLastCalledWith('registration.allowedDomains', []);
    expect(screen.getByText('Anyone with an email address can sign up.')).toBeInTheDocument();
  });

  it('asks before removing the last domain of an admin list too', () => {
    const onChange = vi.fn();
    renderSections({
      sections: ['registration'],
      overrides: { registration: { allowedDomains: ['acme.com'] } },
      onChange,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove acme.com' }));
    const dialog = screen.getByRole('dialog', { name: 'Let anyone sign up?' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Let anyone sign up' }));
    expect(onChange).toHaveBeenLastCalledWith('registration.allowedDomains', undefined);
  });

  it('shows the startup settings with their librechat.yaml values, never a stale override', () => {
    const setup = {
      sections: ['registration'],
      yaml: { registration: { oauthStateTtlMs: 120000, openidDiscovery: { startupAttempts: 3 } } },
      overrides: {
        registration: { oauthStateTtlMs: 60000, openidDiscovery: { startupAttempts: 9 } },
      },
    };
    const ttl = () => document.getElementById('registration-oauthStateTtlMs');
    const attempts = () => document.getElementById('registration-openidDiscovery-startupAttempts');
    const { unmount } = renderSections(setup);
    expect(ttl()).toHaveTextContent('120,000');
    expect(attempts()).toHaveTextContent('3');
    unmount();
    renderSections({ ...setup, profile: { registration: { allowedDomains: ['example.com'] } } });
    expect(ttl()).toHaveTextContent('120,000');
    expect(ttl()).not.toHaveTextContent('60,000');
    expect(attempts()).not.toHaveTextContent('9');
  });

  it('lists a startup setting the schema does not know inside its group', () => {
    renderSections({
      sections: ['registration'],
      yaml: { registration: { openidDiscovery: { startupAttempts: 3, backoffJitter: 0.2 } } },
    });
    const group = document
      .getElementById('section-registration.openidDiscovery')!
      .closest('section') as HTMLElement;
    expect(within(group).getByText('backoffJitter')).toBeInTheDocument();
    expect(within(group).getByText('0.2')).toBeInTheDocument();
  });

  it('shows the settings LibreChat sets up at startup read-only', () => {
    renderSections({
      sections: ['registration'],
      yaml: YAML,
      overrides: { registration: { oauthStateTtlMs: 60000 } },
    });
    expect(screen.getByText(/sets up social sign-in and OpenID discovery/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /OAuth state TTL/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove stale override' })).toBeInTheDocument();
  });
});
