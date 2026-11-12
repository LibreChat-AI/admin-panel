import { describe, it, expect } from 'vitest';
import { domainIssue, normalizeDomain, splitDomainEntries } from './domains';

const WEB = ['http', 'https'];
const ALL = ['http', 'https', 'ws', 'wss'];

describe('domainIssue', () => {
  it('accepts the forms LibreChat parses: host, scheme, port and leading wildcard', () => {
    for (const entry of [
      'example.com',
      'api.example.com',
      'https://example.com',
      'https://example.com:8443',
      'example.com:8080',
      '*.example.com',
      'https://*.example.com',
      '10.0.0.5',
      'localhost',
      'https://example.com/',
    ]) {
      expect(domainIssue(entry, WEB), entry).toBeNull();
    }
  });

  it('rejects blanks, spaces and protocol-only text', () => {
    expect(domainIssue('', WEB)).toBe('invalid');
    expect(domainIssue('   ', WEB)).toBe('invalid');
    expect(domainIssue('exa mple.com', WEB)).toBe('invalid');
    expect(domainIssue('https://', WEB)).toBe('invalid');
    expect(domainIssue('-bad.example.com', WEB)).toBe('invalid');
  });

  it('rejects wildcards anywhere but the first label, and paths', () => {
    expect(domainIssue('api.*.example.com', WEB)).toBe('wildcard');
    expect(domainIssue('*example.com', WEB)).toBe('wildcard');
    expect(domainIssue('example.com/api', WEB)).toBe('path');
    expect(domainIssue('https://example.com?x=1', WEB)).toBe('path');
  });

  it('only accepts the schemes the list allows', () => {
    expect(domainIssue('wss://ws.example.com', WEB)).toBe('protocol');
    expect(domainIssue('wss://ws.example.com', ALL)).toBeNull();
    expect(domainIssue('ftp://example.com', ALL)).toBe('protocol');
  });

  it('flags an entry already in the list, ignoring case and a trailing slash', () => {
    expect(domainIssue('Example.com/', WEB, ['example.com'])).toBe('duplicate');
    expect(domainIssue('example.org', WEB, ['example.com'])).toBeNull();
  });
});

describe('normalizeDomain / splitDomainEntries', () => {
  it('stores entries trimmed, lowercase and without a trailing slash', () => {
    expect(normalizeDomain('  HTTPS://Example.COM/ ')).toBe('https://example.com');
  });

  it('splits pasted lists on commas, semicolons and whitespace', () => {
    expect(splitDomainEntries('a.com, b.com;c.com\n d.com  ')).toEqual([
      'a.com',
      'b.com',
      'c.com',
      'd.com',
    ]);
  });
});
