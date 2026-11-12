import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { describeEntryOverrides } from './labels';
import { AZURE_GROUPS_PATH } from '@/constants';
import i18n from '@/locales/i18n';

const localize: t.LocalizeFn = (key, options) => i18n.t(key, options ?? {});

function profile(principalType: PrincipalType, name: string): t.ConfigScope {
  return { principalType, principalId: name, name, priority: 10, isActive: true };
}

const user = profile(PrincipalType.ROLE, 'USER');
const eng = profile(PrincipalType.GROUP, 'Engineering');

const override = (scope: t.ConfigScope, parts: Partial<t.EntryOverride> = {}): t.EntryOverride => ({
  scope,
  overrides: true,
  secrets: [],
  settings: [],
  hidden: false,
  ...parts,
});

const holding = { secrets: ['apiKey.key'] };

describe('describeEntryOverrides', () => {
  it('says a rename leaves the override and the stored key under the old name, and who gets Base credentials', () => {
    expect(
      describeEntryOverrides(
        [override(user, holding)],
        { kind: 'renamed', name: 'acme-kb', next: 'acme-2', taken: false },
        localize,
      ),
    ).toEqual([
      'Role: USER overrides "acme-kb". The override stays under that name, so its members get "acme-2" without it, plus a leftover "acme-kb" until it is removed there.',
      'Role: USER stores its own key for "acme-kb". The key stays under that name too, so its members get "acme-2" with Base\'s credentials instead.',
    ]);
  });

  it('names every profile, and says a hide no longer hides the renamed entry', () => {
    expect(
      describeEntryOverrides(
        [override(user), override(eng, { overrides: false, hidden: true })],
        { kind: 'renamed', name: 'acme-kb', next: 'acme-2', taken: false },
        localize,
      ),
    ).toEqual([
      'Role: USER overrides "acme-kb". The override stays under that name, so its members get "acme-2" without it, plus a leftover "acme-kb" until it is removed there.',
      'Group: Engineering hides "acme-kb". The hide stays under that name, so its members can use "acme-2".',
    ]);
    expect(
      describeEntryOverrides(
        [override(user), override(eng)],
        { kind: 'renamed', name: 'AcmeLLM', next: 'AcmeLLM2', taken: false },
        localize,
      )[0],
    ).toBe(
      'Role: USER, Group: Engineering override "AcmeLLM". The overrides stay under that name, so their members get "AcmeLLM2" without them, plus a leftover "AcmeLLM" until they are removed there.',
    );
  });

  it('says an override applies to the entry that takes the old name in a swap', () => {
    expect(
      describeEntryOverrides(
        [override(user, holding)],
        { kind: 'renamed', name: 'vault', next: 'keys', taken: true },
        localize,
      ),
    ).toEqual([
      'Role: USER overrides "vault". The override stays under that name, so it applies to the one saved as "vault" now, not to "keys".',
      'Role: USER stores its own key for "vault", which stays with its override.',
    ]);
  });

  it('says a removal leaves the override and its key, and ignores a hide of the removed entry', () => {
    expect(
      describeEntryOverrides(
        [override(user, holding), override(eng, { overrides: false, hidden: true })],
        { kind: 'removed', name: 'acme-kb' },
        localize,
      ),
    ).toEqual([
      'Role: USER overrides "acme-kb". The override stays, so its members get a leftover "acme-kb" until it is removed there.',
      'Role: USER stores its own key for "acme-kb", which stays with its override.',
    ]);
    expect(describeEntryOverrides([], { kind: 'removed', name: 'acme-kb' }, localize)).toEqual([]);
  });

  it('says a moved destination stops the keys the profiles store, naming only them', () => {
    expect(
      describeEntryOverrides(
        [override(user, holding), override(eng, { secrets: ['apiKey'] })],
        { kind: 'moved', name: 'acme-kb' },
        localize,
      ),
    ).toEqual([
      'Role: USER, Group: Engineering store their own keys for "acme-kb", which LibreChat sends only where they were entered. This save changes where "acme-kb" sends them, so their members get "acme-kb" without those keys until they are entered again there.',
    ]);
  });

  it('says a rename or new entry onto a name profiles still override takes their overrides, keys and hides', () => {
    const profiles = [override(user, holding), override(eng, { overrides: false, hidden: true })];
    expect(
      describeEntryOverrides(
        profiles,
        { kind: 'took', name: 'acme-kb', sendsKeys: false },
        localize,
      ),
    ).toEqual([
      'Role: USER still overrides "acme-kb". The override applies to this one once it is saved under that name, until it is removed there.',
      'Role: USER stores its own key for "acme-kb" too, entered for where "acme-kb" sent it then. LibreChat doesn\'t send it to this one, so its members get this one without that key until it is entered again there.',
      'Group: Engineering hides "acme-kb", so its members can\'t use this one once it is saved under that name.',
    ]);
    expect(
      describeEntryOverrides(
        [override(user, holding)],
        { kind: 'took', name: 'acme-kb', sendsKeys: true },
        localize,
      )[1],
    ).toBe('Role: USER stores its own key for "acme-kb" too, which LibreChat sends to this one.');
  });

  it("says a removed or renamed Azure group leaves a profile's override as a group that can't resolve, so LibreChat ignores its group overrides", () => {
    const partial = override(user, { settings: ['version'], secrets: ['apiKey'] });
    const standalone = override(eng, { settings: ['instanceName', 'version'] });
    expect(
      describeEntryOverrides(
        [partial, standalone],
        { kind: 'removed', name: 'rv-west' },
        localize,
        AZURE_GROUPS_PATH,
      ),
    ).toEqual([
      'Role: USER overrides "rv-west". The override stays, as a group of its own without an instance or base URL, so LibreChat ignores every Azure group override Role: USER stores until it is removed there.',
      'Group: Engineering overrides "rv-west". The override stays, so its members get a leftover "rv-west" until it is removed there.',
      'Role: USER stores its own key for "rv-west", which stays with its override.',
    ]);
    expect(
      describeEntryOverrides(
        [partial],
        { kind: 'renamed', name: 'rv-west', next: 'rv-north', taken: false },
        localize,
        AZURE_GROUPS_PATH,
      )[0],
    ).toBe(
      'Role: USER overrides "rv-west". The override stays under that name, as a group of its own without an instance or base URL, so its members get "rv-north" without it, and LibreChat ignores every other Azure group override Role: USER stores until it is removed there.',
    );
    expect(
      describeEntryOverrides(
        [partial],
        { kind: 'removed', name: 'rv-west' },
        localize,
        'endpoints.custom',
      )[0],
    ).toBe(
      'Role: USER overrides "rv-west". The override stays, so its members get a leftover "rv-west" until it is removed there.',
    );
  });
});
