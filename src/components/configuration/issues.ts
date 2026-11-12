import type * as t from '@/types';
import {
  getEntryKey,
  hasIssueMessage,
  getKeyedCollection,
  paramlessIssueCode,
  findKeyedCollectionEntry,
} from '@/utils';
import { labelForPath } from './meta';

/** The collection path an issue belongs to, when it is inside (or about) a collection entry. */
function issueCollection(issue: t.ConfigIssue): t.KeyedCollection | undefined {
  return getKeyedCollection(issue.path) ?? findKeyedCollectionEntry(issue.path)?.collection;
}

/**
 * Where an issue shows on the page: entry issues are mapped by the entry's
 * identity to its position in the pending (displayed) items, since issue
 * paths index into the array that was validated or sent, not the page's.
 */
export function issueDisplayPath(issue: t.ConfigIssue, collections: t.PendingCollection[]): string {
  const collection = issueCollection(issue);
  if (!collection || issue.entryIdentity === undefined) return issue.path;
  const pending = collections.find((c) => c.collection.path === collection.path);
  if (!pending) return issue.path;
  const { items, edit } = pending;
  const byKey = items.findIndex(
    (item) => getEntryKey(item, collection.key) === issue.entryIdentity,
  );
  const index =
    byKey >= 0 ? byKey : edit.origins.findIndex((o) => o?.identity === issue.entryIdentity);
  if (index < 0) return collection.path;
  const base = `${collection.path}.${index}`;
  return issue.entryPath ? `${base}.${issue.entryPath}` : base;
}

const BOUND_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/**
 * Issue parameters for display: numbers with digit grouping ("60,000"), and
 * the settings an issue names (`fieldPaths`, `|`-separated) as their labels
 * (`fields`: "Server URL, Transport").
 */
function displayParams(
  params: t.ConfigIssue['params'],
  localize: t.LocalizeFn,
): Record<string, string | number> | undefined {
  if (!params) return params;
  const shown: Record<string, string | number> = Object.fromEntries(
    Object.entries(params).map(([name, value]) => [
      name,
      typeof value === 'number' ? BOUND_FORMAT.format(value) : value,
    ]),
  );
  if (typeof params.fieldPaths === 'string' && params.fieldPaths !== '') {
    const labels = params.fieldPaths.split('|').map((path) => labelForPath(path, localize));
    shown.fields = [...new Set(labels)].join(', ');
  }
  return shown;
}

/**
 * Localized message of an issue: `com_config_issue_<code>` when there is one,
 * else the server's text. An issue without parameters (the admin API reports
 * codes only) is worded without them (`paramlessIssueCode`).
 */
function issuePredicate(issue: t.ConfigIssue, localize: t.LocalizeFn): string {
  if (!issue.code) return issue.message;
  const code = issue.params ? issue.code : paramlessIssueCode(issue.code);
  const key = `com_config_issue_${code.toLowerCase()}`;
  const localized = localize(key, displayParams(issue.params, localize));
  return localized === key ? issue.message : localized;
}

/** "Label must …" for predicates; a free-form message keeps its own wording when it already names the field. */
function labeledMessage(label: string, message: string, isPredicate: boolean): string {
  if (isPredicate) return `${label} ${message}`;
  if (message.toLowerCase().startsWith(label.toLowerCase())) return message;
  return `${label}: ${message}`;
}

/**
 * Readable text for an issue: `inline` for the field itself ("Provider must
 * be "anthropic"") and `summary` naming the entry for lists ("GPT › Provider
 * must be "anthropic""). Codes without a generic predicate (refinement
 * messages, entry-level problems) are shown as full sentences.
 */
export function formatIssue(
  issue: t.ConfigIssue,
  displayPath: string,
  localize: t.LocalizeFn,
): { inline: string; summary: string } {
  const predicate = issuePredicate(issue, localize);
  const entryLevel = issue.entryIdentity !== undefined && !issue.entryPath;
  if (entryLevel) return { inline: predicate, summary: predicate };
  /** An entry field the page doesn't list (an import's new entry) is named by the field, not the collection. */
  const labelPath =
    issue.entryPath && issueCollection(issue)?.path === displayPath
      ? `${displayPath}.0.${issue.entryPath}`
      : displayPath;
  const label = labelForPath(labelPath, localize);
  const inline = labeledMessage(label, predicate, hasIssueMessage(issue.code));
  const identity = issue.entryIdentity?.trim() ? issue.entryIdentity : undefined;
  const unnamed = issue.entryIdentity !== undefined && identity === undefined;
  const entry = unnamed ? localize('com_config_issue_unnamed_entry') : identity;
  const summary = entry ? `${entry} › ${inline}` : inline;
  return { inline, summary };
}

/**
 * A plain list's item an issue is about (`mcpSettings.allowedAddresses.0`):
 * the list row shows the item's first problem ("Item 1: must include a
 * port"), since the list control has no row per item. Entries of keyed
 * collections show their issues in their own cards.
 */
function listItemOf(
  issue: t.ConfigIssue,
  path: string,
): { listPath: string; index: number } | undefined {
  if (issueCollection(issue)) return undefined;
  const dot = path.lastIndexOf('.');
  const segment = path.slice(dot + 1);
  if (dot < 0 || !/^\d+$/.test(segment)) return undefined;
  return { listPath: path.slice(0, dot), index: Number(segment) };
}

/** Per-path inline messages and a summary line per issue, for the errors map and the review. */
export function describeIssues(
  issues: t.ConfigIssue[],
  collections: t.PendingCollection[],
  localize: t.LocalizeFn,
): { fieldErrors: Record<string, string>; summaries: string[] } {
  const fieldErrors: Record<string, string> = {};
  const summaries: string[] = [];
  for (const issue of issues) {
    const path = issueDisplayPath(issue, collections);
    const { inline, summary } = formatIssue(issue, path, localize);
    fieldErrors[path] = fieldErrors[path] ? `${fieldErrors[path]}; ${inline}` : inline;
    if (!summaries.includes(summary)) summaries.push(summary);
    const item = listItemOf(issue, path);
    if (item && !fieldErrors[item.listPath]) {
      fieldErrors[item.listPath] = localize('com_config_issue_list_item', {
        n: item.index + 1,
        message: issuePredicate(issue, localize),
      });
    }
  }
  return { fieldErrors, summaries };
}
