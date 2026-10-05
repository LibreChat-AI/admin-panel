import {
  CAPABILITY_CATEGORIES as UPSTREAM_CAPABILITY_CATEGORIES,
  CapabilityImplications as UPSTREAM_CAPABILITY_IMPLICATIONS,
} from '@librechat/data-schemas/capabilities';

export {
  SystemCapabilities,
  expandImplications,
  hasImpliedCapability,
} from '@librechat/data-schemas/capabilities';

/**
 * Forward-compat shim: the LibreChat backend gates `/api/admin/audit-log` on
 * this capability string, and the LC sibling PR adds it to
 * `SystemCapabilities` in `@librechat/data-schemas@0.0.53`. Until that version
 * is published to npm and the pin here is bumped, referencing
 * `SystemCapabilities.READ_AUDIT_LOG` directly breaks `tsc` against the
 * currently-pinned `^0.0.52`. The value is byte-identical to what the upstream
 * constant will resolve to post-publish; drop this constant in a one-line
 * follow-up once the data-schemas pin moves to `^0.0.53`.
 */
export const READ_AUDIT_LOG_CAPABILITY = 'read:audit_log' as const;

/**
 * Forward-compat shim: the LibreChat backend gates `/api/admin/balance` on
 * these two capabilities (`READ_BALANCES`/`MANAGE_BALANCES`). They don't exist
 * yet in the pinned `@librechat/data-schemas` version — byte-identical to what
 * the upstream constants will resolve to post-publish. Drop these two
 * constants, the `CAPABILITY_CATEGORIES` addition below, and the
 * `CapabilityImplications` override below in a one-line follow-up once the
 * data-schemas pin includes them natively.
 */
export const READ_BALANCES_CAPABILITY = 'read:balances' as const;
export const MANAGE_BALANCES_CAPABILITY = 'manage:balances' as const;

/**
 * Local override of the upstream `CAPABILITY_CATEGORIES` so the System
 * category surfaces `READ_AUDIT_LOG`/`READ_BALANCES`/`MANAGE_BALANCES` in the
 * grants editing UI even while the dep is pinned to a version that predates
 * these category entries. Without this, only seeded admins could ever hold
 * these capabilities — the grants `CapabilityPanel` would have no row to
 * toggle.
 *
 * Drops to a no-op once each capability's real upstream version is pinned,
 * because the upstream array will already contain it; the dedupe pass below
 * keeps this safe to leave shipped until the shims themselves are removed.
 */
const SHIMMED_SYSTEM_CAPABILITIES = [
  READ_AUDIT_LOG_CAPABILITY,
  READ_BALANCES_CAPABILITY,
  MANAGE_BALANCES_CAPABILITY,
] as const;

export const CAPABILITY_CATEGORIES: typeof UPSTREAM_CAPABILITY_CATEGORIES =
  UPSTREAM_CAPABILITY_CATEGORIES.map((cat) => {
    if (cat.key !== 'system') return cat;
    const caps = cat.capabilities as readonly string[];
    const missing = SHIMMED_SYSTEM_CAPABILITIES.filter((cap) => !caps.includes(cap));
    if (missing.length === 0) return cat;
    return {
      ...cat,
      capabilities: [...cat.capabilities, ...missing],
    } as typeof cat;
  });

/**
 * Local override of the upstream `CapabilityImplications` map so the grants
 * editor knows `MANAGE_BALANCES` implies `READ_BALANCES` (toggling manage on
 * auto-checks read) even while the dep is pinned to a version that predates
 * this implication entry. Drops to a no-op merge once the real pin lands,
 * since the upstream map will already have the same entry.
 */
export const CapabilityImplications: Record<string, readonly string[]> = {
  ...UPSTREAM_CAPABILITY_IMPLICATIONS,
  [MANAGE_BALANCES_CAPABILITY]: [READ_BALANCES_CAPABILITY],
};
