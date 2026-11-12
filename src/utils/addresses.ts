import { allowedAddressesSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import { ADDRESS_ISSUE_KEYS } from '@/constants';

/** LibreChat's `allowedAddresses` refinements, in the order it checks them. */
const ISSUE_PATTERNS: ReadonlyArray<[RegExp, t.AddressIssue]> = [
  [/non-empty/, 'empty'],
  [/host:port pairs/, 'url'],
  [/include a port/, 'port'],
  [/private IP space/, 'public'],
];

/** Key of the private-address allowlists (`endpoints`, `mcpSettings`, `actions`, `webSearch`, `ocr`, speech). */
const ADDRESS_LIST_KEY = 'allowedAddresses';

/** Whether a path is one of LibreChat's `allowedAddresses` lists, which share one schema. */
export function isAddressListPath(path: string): boolean {
  return path === ADDRESS_LIST_KEY || path.endsWith(`.${ADDRESS_LIST_KEY}`);
}

/**
 * The first problem LibreChat would report for an `allowedAddresses` entry
 * (AP-7), checked with its own schema: Zod runs every refinement, so
 * `localhost` fails both "include a port" and "private IP space", and only
 * the first is relevant. Null when the entry is valid.
 */
export function addressIssue(entry: string): t.AddressIssue | null {
  const result = allowedAddressesSchema.safeParse([entry]);
  if (result.success) return null;
  const message = result.error.issues[0]?.message ?? '';
  return ISSUE_PATTERNS.find(([pattern]) => pattern.test(message))?.[1] ?? 'format';
}

/** The message for an `allowedAddresses` entry LibreChat would reject, or null when it is valid. */
export function addressItemError(entry: string, localize: t.LocalizeFn): string | null {
  const issue = addressIssue(entry);
  return issue ? localize(ADDRESS_ISSUE_KEYS[issue]) : null;
}
