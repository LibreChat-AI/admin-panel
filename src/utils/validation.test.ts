import { z } from 'zod';
import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  parseSafely,
  toConfigIssues,
  describeIssueCode,
  isUnknownEnumValue,
  paramlessIssueCode,
  findUnknownEnumValue,
  classifyReportedIssue,
} from './validation';
import { describeApiError, errorText } from './errors';

function wording(code: string, params?: Parameters<typeof classifyReportedIssue>[1]): string {
  const issue = classifyReportedIssue(code, params);
  return describeIssueCode(issue.code, issue.params, 'is not a valid value');
}

describe('classifyReportedIssue', () => {
  it('words a code without its parameters when the server reports none', () => {
    expect(classifyReportedIssue('too_small', undefined)).toEqual({ code: 'too_small_value' });
    expect(classifyReportedIssue('custom', undefined)).toEqual({ code: 'custom' });
    expect(paramlessIssueCode('dotted_key')).toBe('dotted_key');
  });

  it('words bounds by what they bound and whether they are inclusive', () => {
    expect(
      wording('too_small', { minimum: 1, inclusive: true, exact: false, type: 'number' }),
    ).toBe('must be at least 1');
    expect(
      wording('too_big', { maximum: 100, inclusive: false, exact: false, type: 'number' }),
    ).toBe('must be less than 100');
    expect(wording('too_small', { minimum: 3, inclusive: true, type: 'string' })).toBe(
      'must be at least 3 characters',
    );
    expect(wording('too_big', { maximum: 5, inclusive: true, type: 'array' })).toBe(
      'must have at most 5 items',
    );
    expect(classifyReportedIssue('too_small', { inclusive: true, type: 'date' })).toEqual({
      code: 'too_small_value',
    });
  });

  it('words expected types, literals and options', () => {
    expect(wording('invalid_type', { expected: 'integer', received: 'number' })).toBe(
      'must be a whole number',
    );
    expect(wording('invalid_type', { expected: 'string', received: 'undefined' })).toBe(
      'is required',
    );
    expect(wording('invalid_literal', { expected: 'stdio' })).toBe('must be "stdio"');
    expect(wording('invalid_enum_value', { options: ['low', 'high'] })).toBe(
      'must be one of "low", "high"',
    );
    expect(wording('invalid_union_discriminator', { options: ['sse', 'http'] })).toBe(
      'must be one of "sse", "http"',
    );
    expect(wording('invalid_enum_value', { options: [] })).toBe('is not one of the allowed values');
  });

  it('words string checks, multiples and a refinement by its reason', () => {
    expect(wording('invalid_string', { validation: 'url' })).toBe('must be a valid URL');
    expect(wording('invalid_string', { validation: 'regex' })).toBe('is not a valid value');
    expect(wording('not_multiple_of', { multipleOf: 5 })).toBe('must be a multiple of 5');
    expect(wording('custom', { reason: 'missing_port' })).toBe(
      'must include a port, for example localhost:11434',
    );
    expect(wording('custom', { reason: 'public_ip' })).toBe(
      'is a public IP address: enter a private address, or a hostname that resolves to one',
    );
    expect(classifyReportedIssue('custom', { reason: 'some_new_rule' })).toEqual({
      code: 'custom',
    });
  });
});

describe('describeApiError', () => {
  it("words the admin API's stable codes, and leaves others to the server's text", () => {
    expect(describeApiError({ code: 'PRINCIPAL_NOT_FOUND' })).toMatch(/doesn't exist/);
    expect(describeApiError({ code: 'FORBIDDEN_SECTION', section: 'memory' })).toBe(
      "You don't have permission to change the memory settings.",
    );
    expect(describeApiError({ code: 'CONFIG_VERSION_CONFLICT' })).toMatch(/Reload the page/);
    expect(describeApiError({ code: 'AUTH_REQUIRED' })).toMatch(/session expired/);
    expect(describeApiError({ code: 'SOME_FUTURE_CODE', error: 'Text' })).toBeNull();
    expect(describeApiError({ error: 'Text' })).toBeNull();
  });

  it('keeps an error text as it is', () => {
    const localize = (key: string) => key;
    expect(errorText(new Error('There is no role named "X"'), 'fallback', localize)).toBe(
      'There is no role named "X"',
    );
  });
});

/** Config issues of `value` against `schema` at `base`, as the save pipeline reads them. */
function issuesOf(schema: t.ParseableSchema, value: t.ConfigValue, base = 'base'): t.ConfigIssue[] {
  const result = parseSafely(schema, value);
  return result.success || !result.error ? [] : toConfigIssues(result.error.issues, base, schema);
}

/** Zod 4 issues (`invalid_value`, `invalid_format`, nested union and key issues) in the panel's words. */
describe('toConfigIssues — zod 4 issues', () => {
  const schema = z.object({
    mode: z.enum(['all', 'temporary']),
    fields: z.array(z.enum(['text'])).optional(),
    tokenUse: z.literal('access').optional(),
    stage: z.literal(['beta', 'stable']).optional(),
    name: z.string(),
    count: z.number().int().gt(0).optional(),
    tags: z.array(z.string()).min(1).optional(),
    title: z.string().min(2).optional(),
    site: z.string().url().optional(),
    mail: z.string().email().optional(),
    choice: z.union([z.object({ inner: z.number() }), z.string()]).optional(),
    keyed: z.record(z.string().regex(/^a/), z.number()).optional(),
    kind: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('a') }),
        z.object({ type: z.literal('b') }),
      ])
      .optional(),
  });
  const valid = { mode: 'all', name: 'n' };
  const issue = (value: t.ConfigRecord) => issuesOf(schema, { ...valid, ...value });

  it("names an enum's values and carries the text it refused", () => {
    expect(issue({ mode: 'someday' })).toEqual([
      {
        path: 'base.mode',
        code: 'invalid_enum_value',
        params: { options: '"all", "temporary"' },
        message: 'must be one of "all", "temporary"',
        received: 'someday',
      },
    ]);
  });

  it('tells a one-member enum from a literal by the schema, though zod 4 reports both alike', () => {
    const [member] = issue({ fields: ['zz'] });
    expect(member).toMatchObject({
      path: 'base.fields.0',
      code: 'invalid_enum_value',
      received: 'zz',
    });
    expect(isUnknownEnumValue(member)).toBe(true);
    const [literal] = issue({ tokenUse: 'zz' });
    expect(literal).toEqual({
      path: 'base.tokenUse',
      code: 'invalid_literal',
      params: { expected: '"access"' },
      message: 'must be "access"',
    });
    expect(isUnknownEnumValue(literal)).toBe(false);
  });

  it('calls a literal with more than one value an enum, as LibreChat reports it', () => {
    const expected = {
      path: 'base.stage',
      code: 'invalid_enum_value',
      params: { options: '"beta", "stable"' },
      message: 'must be one of "beta", "stable"',
      received: 'zz',
    };
    expect(issue({ stage: 'zz' })).toEqual([expected]);
    const result = parseSafely(schema, { ...valid, stage: 'zz' });
    expect(
      result.success || !result.error ? [] : toConfigIssues(result.error.issues, 'base'),
    ).toEqual([expected]);
  });

  it('calls a missing value required, an enum included, and a number in an enum a block', () => {
    const missing = issuesOf(schema, {});
    expect(missing.map((i) => `${i.path}:${i.code}`)).toEqual([
      'base.mode:required',
      'base.name:required',
    ]);
    const [number] = issue({ mode: 5 });
    expect(number).toMatchObject({ code: 'invalid_enum_value', received: 5 });
    expect(isUnknownEnumValue(number)).toBe(false);
  });

  it('words bounds, whole numbers and string formats', () => {
    const words = (value: t.ConfigRecord) => issue(value).map((i) => i.message);
    expect(words({ count: 1.5 })).toEqual(['must be a whole number']);
    expect(words({ count: 0 })).toEqual(['must be greater than 0']);
    expect(words({ tags: [] })).toEqual(['must have at least 1 items']);
    expect(words({ title: 'x' })).toEqual(['must be at least 2 characters']);
    expect(words({ site: 'nope' })).toEqual(['must be a valid URL']);
    expect(words({ mail: 'nope' })).toEqual(['must be a valid email address']);
  });

  it("finds a union's fault in its closest branch, at the branch's full path, and never carries it", () => {
    expect(issue({ choice: { inner: 'x' } })).toEqual([
      {
        path: 'base.choice.inner',
        code: 'invalid_type',
        params: { expected: 'a number' },
        message: 'must be a number',
      },
    ]);
  });

  it("reports a record key's own failure at the key", () => {
    expect(issue({ keyed: { b: 1 } }).map((i) => `${i.path}:${i.code}`)).toEqual([
      'base.keyed.b:invalid_string',
    ]);
  });

  it("keeps zod's wording for a discriminator no variant has", () => {
    expect(issue({ kind: { type: 'c' } })).toEqual([
      {
        path: 'base.kind.type',
        code: 'invalid_union_discriminator',
        params: {},
        message: "Invalid discriminator value. Expected 'a' | 'b'",
      },
    ]);
  });
});

describe('findUnknownEnumValue', () => {
  const schema = z.object({
    mode: z.enum(['all', 'temporary']),
    fields: z.array(z.enum(['text'])),
    tokenUse: z.literal('access'),
    stage: z.literal(['beta', 'stable']).optional(),
    choice: z.union([z.object({ mode: z.enum(['x', 'y']) }), z.string()]),
  });
  const unknownOf = (value: t.ConfigRecord) => {
    const result = schema.safeParse(value, { reportInput: true });
    return result.success ? [] : result.error.issues.map((i) => findUnknownEnumValue(i, schema));
  };
  const valid = { mode: 'all', fields: ['text'], tokenUse: 'access', choice: 's' };

  it('finds text an enum does not list, with the values it does', () => {
    expect(unknownOf({ ...valid, mode: 'someday' })).toEqual([
      { value: 'someday', options: ['all', 'temporary'] },
    ]);
    expect(unknownOf({ ...valid, fields: ['zz'] })).toEqual([{ value: 'zz', options: ['text'] }]);
    expect(unknownOf({ ...valid, stage: 'zz' })).toEqual([
      { value: 'zz', options: ['beta', 'stable'] },
    ]);
  });

  it("finds none for a number, a literal, or an enum inside a union's branch", () => {
    expect(unknownOf({ ...valid, mode: 5 })).toEqual([undefined]);
    expect(unknownOf({ ...valid, tokenUse: 'zz' })).toEqual([undefined]);
    expect(unknownOf({ ...valid, choice: { mode: 'z' } })).toEqual([undefined]);
  });

  it('finds none without the input (a parse without reportInput)', () => {
    const result = schema.safeParse({ ...valid, mode: 'someday' });
    expect(result.success).toBe(false);
    expect(findUnknownEnumValue(result.error!.issues[0], schema)).toBeUndefined();
  });
});
