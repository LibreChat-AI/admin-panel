/**
 * Local shim for `AdminBalanceListItem` — not yet part of the pinned
 * `librechat-data-provider` version. Byte-identical to the real type added
 * to that package; delete this file and import from `librechat-data-provider`
 * once the pin is bumped past the version that includes it.
 */
export type AdminBalanceListItem = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  /**
   * 0 when the user has no Balance document yet OR when `balanceEnabled` is
   * false — always check `balanceEnabled` before treating this as a real,
   * exhausted balance.
   */
  tokenCredits: number;
  /** Whether the balance feature is actually enabled for this user's
   *  effective (role/user-override-resolved) config. */
  balanceEnabled: boolean;
  lastRefill?: string;
  /** The user's configured auto-refill amount, if any — used as a sensible
   *  per-user default top-up amount in the Add credit dialog. */
  refillAmount?: number;
  pendingRequest?: {
    requestId: string;
    requestedAt: string;
    reason?: string;
  };
};

export type BalanceListView = 'all' | 'requests';
