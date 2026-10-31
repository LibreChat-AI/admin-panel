import { z } from 'zod';
import { describe, it, expect } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import { extractSchemaTree, extractSchemaDefaults, flattenTree, getZodTypeName } from './schema';
import { resolveSubSchema } from '@/utils';

const realTree = extractSchemaTree(configSchema);
const realFields = new Map(flattenTree(realTree).map((field) => [field.path, field]));

function field(tree: t.SchemaField[], path: string): t.SchemaField {
  const found = flattenTree(tree).find((f) => f.path === path);
  if (!found) throw new Error(`no field ${path}`);
  return found;
}

function realField(path: string): t.SchemaField {
  const found = realFields.get(path);
  if (!found) throw new Error(`no schema field ${path}`);
  return found;
}

describe('extractSchemaTree — variants', () => {
  const trigger = z.discriminatedUnion('type', [
    z.object({ type: z.literal('token_ratio'), value: z.number().min(0).max(1) }),
    z.object({ type: z.literal('remaining_tokens'), value: z.number().int().positive() }),
  ]);
  const agent = z.union([
    z.object({ enabled: z.boolean().optional(), id: z.string() }),
    z.object({ enabled: z.boolean().optional(), provider: z.string(), model: z.string() }),
  ]);
  const tree = extractSchemaTree(
    z.object({ trigger: trigger.optional(), agent: agent.optional() }),
  );

  it('turns a discriminated union into variants keyed by the discriminator value', () => {
    const triggerField = field(tree, 'trigger');
    expect(triggerField).toMatchObject({ type: 'object', isObject: true, discriminator: 'type' });
    expect(triggerField.variants?.map((v) => v.key)).toEqual(['token_ratio', 'remaining_tokens']);
    expect(triggerField.variants?.[1].fields.map((f) => f.key)).toEqual(['type', 'value']);
    expect(triggerField.variants?.[0].fields[1].constraints).toEqual({
      min: 0,
      max: 1,
      step: 0.01,
    });
  });

  it('keeps a merged child list: one select of every literal and limits all variants accept', () => {
    const merged = field(tree, 'trigger').children ?? [];
    expect(merged.map((f) => f.key)).toEqual(['type', 'value']);
    expect(merged[0].type).toBe('union(literal("token_ratio") | literal("remaining_tokens"))');
    expect(merged[1].constraints).toEqual({ min: 0 });
    expect(merged.every((f) => f.isOptional)).toBe(true);
  });

  it('names the variants of a plain union of objects by their first unique key', () => {
    const agentField = field(tree, 'agent');
    expect(agentField.discriminator).toBeUndefined();
    expect(agentField.variants?.map((v) => v.key)).toEqual(['id', 'provider']);
    expect(agentField.children?.map((f) => f.key)).toEqual(['enabled', 'id', 'provider', 'model']);
  });

  it('takes a key undefined in some variants from the variant that defines it', () => {
    const transports = z.record(
      z.string(),
      z.union([
        z.object({ command: z.string(), obo: z.undefined().optional() }),
        z.object({ url: z.string(), obo: z.object({ scopes: z.string() }).optional() }),
      ]),
    );
    const servers = extractSchemaTree(z.object({ servers: transports }));
    const obo = field(servers, 'servers.{}.obo');
    expect(obo).toMatchObject({ type: 'object', isObject: true, isOptional: true });
    expect(obo.children?.map((f) => f.key)).toEqual(['scopes']);
  });

  it('describes the real summarization trigger, memory agent and MCP obo', () => {
    expect(realField('summarization.trigger').variants?.map((v) => v.key)).toEqual([
      'token_ratio',
      'remaining_tokens',
      'messages_to_refine',
    ]);
    expect(realField('summarization.trigger.value').type).toBe('number');
    expect(realField('memory.agent').variants?.map((v) => v.key)).toEqual(['id', 'provider']);
    expect(realField('mcpServers.{}.obo').children?.map((f) => f.key)).toEqual(['scopes']);
  });
});

describe('extractSchemaTree — arrays, records and unions', () => {
  it('extracts children of refined array elements (skillSync sources)', () => {
    const element = z.object({ id: z.string(), ref: z.string().optional() }).refine(() => true);
    const tree = extractSchemaTree(z.object({ sources: z.array(element).default([]) }));
    expect(field(tree, 'sources')).toMatchObject({ type: 'array<object>', isArray: true });
    expect(field(tree, 'sources').children?.map((f) => f.key)).toEqual(['id', 'ref']);
    expect(realField('skillSync.github.sources').children?.map((f) => f.key)).toContain('owner');
  });

  it('types enum-valued records as string records', () => {
    const tree = extractSchemaTree(
      z.object({ overrides: z.record(z.string(), z.enum(['provider', 'text', 'none'])) }),
    );
    expect(field(tree, 'overrides').recordValueKVTypes).toEqual(['string']);
    expect(field(tree, 'overrides').itemType).toBe('enum(provider | text | none)');
    expect(realField('fileConfig.defaultLLMDeliveryPath.overrides').recordValueKVTypes).toEqual([
      'string',
    ]);
  });

  it('keeps the compact type of scalar unions for the client to parse', () => {
    expect(realField('modelSpecs.list.[].runInBackground').type).toBe(
      'union(boolean | array<string>)',
    );
    expect(realField('modelSpecs.list.[].preset.maxContextTokens').type).toBe(
      'union(number | string)',
    );
    expect(realField('endpoints.azureOpenAI.groups').type).toBe('array<object>');
  });

  it('names discriminated unions and undefined in type strings', () => {
    const union = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a') }),
      z.object({ kind: z.literal('b') }),
    ]);
    expect(getZodTypeName(union)).toBe('union(object | object)');
    expect(getZodTypeName(z.undefined())).toBe('undefined');
  });
});

describe('extractSchemaTree — constraints', () => {
  const tree = extractSchemaTree(
    z.object({
      ratio: z.number().min(0).max(1).optional(),
      count: z.number().int().positive(),
      weight: z.number().min(0).max(5),
      size: z.number().min(0),
      plain: z.number(),
      url: z.string().url(),
      code: z
        .string()
        .length(4)
        .regex(/^[A-Z]+$/),
    }),
  );

  it('extracts numeric bounds with an input step', () => {
    expect(field(tree, 'ratio').constraints).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(field(tree, 'count').constraints).toEqual({
      int: true,
      min: 0,
      minExclusive: true,
      step: 1,
    });
    expect(field(tree, 'weight').constraints).toEqual({ min: 0, max: 5, step: 0.1 });
    expect(field(tree, 'size').constraints).toEqual({ min: 0 });
    expect(field(tree, 'plain').constraints).toBeUndefined();
  });

  it('extracts string formats and lengths', () => {
    expect(field(tree, 'url').constraints).toEqual({ url: true });
    expect(field(tree, 'code').constraints).toEqual({
      minLength: 4,
      maxLength: 4,
      regex: '^[A-Z]+$',
    });
  });

  it('reads limits from the real schema (image quality steps by 0.01)', () => {
    expect(realField('fileConfig.clientImageResize.quality').constraints).toEqual({
      min: 0,
      max: 1,
      step: 0.01,
    });
    expect(realField('endpoints.agents.maxCitations').constraints).toEqual({ min: 1, max: 50 });
  });
});

describe('extractSchemaTree — compact payload', () => {
  it('omits unset properties and false flags', () => {
    const tree = extractSchemaTree(z.object({ name: z.string().optional() }));
    expect(tree[0]).toEqual({
      path: 'name',
      key: 'name',
      type: 'string',
      isOptional: true,
      depth: 0,
    });
  });

  it('never sends undefined or false values for the real schema', () => {
    const offending = flattenTree(realTree).flatMap((f) =>
      Object.entries(f)
        .filter(([key, value]) => value === undefined || (value === false && key !== 'isOptional'))
        .map(([key]) => `${f.path}.${key}`),
    );
    expect(offending).toEqual([]);
  });
});

describe('extractSchemaDefaults', () => {
  it('collects leaf defaults under an object-level default; the object default wins', () => {
    const schema = z.object({
      section: z
        .object({
          mode: z.enum(['all', 'temporary']).default('temporary'),
          limit: z.number().default(10),
          nested: z.object({ depth: z.number().default(3) }).optional(),
        })
        .prefault({ limit: 20 }),
    });
    expect(extractSchemaDefaults(schema)).toEqual({
      section: { mode: 'temporary', limit: 20, nested: { depth: 3 } },
    });
  });

  it('keeps non-object defaults as they are', () => {
    const schema = z.object({ tags: z.array(z.string()).default(['a']), plain: z.string() });
    expect(extractSchemaDefaults(schema)).toEqual({ tags: ['a'] });
  });

  it('finds nested defaults in the real schema', () => {
    const defaults = extractSchemaDefaults(configSchema);
    const get = (path: string) =>
      path.split('.').reduce<t.ConfigValue>((node, key) => {
        if (node && typeof node === 'object' && !Array.isArray(node)) return node[key];
        return undefined;
      }, defaults);
    expect(get('interface.retentionMode')).toBe('temporary');
    expect(get('endpoints.agents.maxProviderErrorChars')).toBe(2000);
    expect(get('endpoints.agents.maxCitations')).toBe(30);
    /** data-provider strips these (`partialWithoutDefaults`) so Zod 4 doesn't inject them on parse. */
    expect(get('registration.openidDiscovery')).toBeUndefined();
    expect(typeof get('mcpSettings.catalogRecovery.discoveryTimeoutMs')).toBe('number');
  });
});

describe('resolveSubSchema — discriminated unions', () => {
  it('resolves and validates leaves of a discriminated union', () => {
    const value = resolveSubSchema(configSchema, [
      'summarization',
      'trigger',
      'value',
    ]) as t.ParseableSchema;
    expect(value).not.toBeNull();
    expect(value.safeParse(0.5).success).toBe(true);
    expect(value.safeParse('0.5').success).toBe(false);
  });
});

/** Zod 4 keeps a schema's kind and wrappers in `_zod.def` (zod 3 had `_def.typeName`). */
describe('extractSchemaTree — Zod 4 schema internals', () => {
  const NumericMode = { OFF: 0, ON: 1 } as const;
  const schema = z.object({
    group: z
      .object({
        name: z.string().optional(),
        models: z.record(z.string(), z.object({ version: z.string().optional() })).optional(),
      })
      .required(),
    withDefault: z.object({ size: z.number().default(3) }).prefault({}),
    plain: z.string().default('x'),
    viaEnv: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().url()),
    trimmed: z.string().transform((value) => value.trim()),
    coerced: z.preprocess((value) => Number(value), z.number().int()),
    lazy: z.lazy(() => z.boolean()),
    caught: z.number().int().min(1).catch(5),
    frozen: z.object({ tags: z.array(z.string()).readonly() }).readonly(),
    described: z.string().describe('The described setting').optional(),
    wrappedDescription: z.string().optional().describe('Described on the wrapper'),
    mode: z.nativeEnum(NumericMode),
    either: z.literal(['a', 'b']),
    counts: z.record(z.string(), z.nativeEnum(NumericMode)),
  });
  const tree = extractSchemaTree(schema);

  it("walks an object's `.required()` fields (nonoptional), required even where they wrap optional", () => {
    expect(field(tree, 'group.name')).toMatchObject({ type: 'string', isOptional: false });
    expect(field(tree, 'group.models')).toMatchObject({ type: 'record', isOptional: false });
    expect(field(tree, 'group.models.{}.version').type).toBe('string');
  });

  it('treats `.prefault()` like `.default()`: optional to write, and its default collected', () => {
    expect(field(tree, 'withDefault')).toMatchObject({ type: 'object', isOptional: true });
    expect(field(tree, 'plain').isOptional).toBe(true);
    expect(extractSchemaDefaults(schema)).toMatchObject({ withDefault: { size: 3 }, plain: 'x' });
  });

  it('steps through `.catch()` (optional to write) and `.readonly()`', () => {
    expect(field(tree, 'caught')).toMatchObject({
      type: 'number',
      isOptional: true,
      constraints: { int: true, min: 1 },
    });
    expect(field(tree, 'frozen')).toMatchObject({ type: 'object', isOptional: false });
    expect(field(tree, 'frozen.tags').type).toBe('array<string>');
  });

  it("reads a pipe's output, and a transform's input", () => {
    expect(field(tree, 'viaEnv')).toMatchObject({ type: 'string', constraints: { url: true } });
    expect(field(tree, 'trimmed').type).toBe('string');
    expect(field(tree, 'coerced')).toMatchObject({ type: 'number', constraints: { int: true } });
    expect(field(tree, 'lazy').type).toBe('boolean');
  });

  it('reads descriptions from the registry, on the schema or its wrapper', () => {
    expect(field(tree, 'described').description).toBe('The described setting');
    expect(field(tree, 'wrappedDescription').description).toBe('Described on the wrapper');
  });

  it('names numeric native enums by member, and a literal of several values as their union', () => {
    expect(field(tree, 'mode').type).toBe('enum(OFF=0 | ON=1)');
    expect(field(tree, 'either').type).toBe('union(literal("a") | literal("b"))');
    expect(field(tree, 'counts').recordValueKVTypes).toEqual(['number']);
  });

  it('reads number and string checks from their definitions', () => {
    const checks = extractSchemaTree(
      z.object({
        whole: z.number().int().gt(0).lte(10),
        ratio: z.number().gte(0).lt(1),
        name: z.string().min(2).max(8),
        code: z.string().length(4),
        site: z.url(),
        mail: z.string().email(),
        slug: z.string().regex(/^[a-z]+$/),
        prefixed: z.string().startsWith('x'),
      }),
    );
    expect(field(checks, 'whole').constraints).toEqual({
      int: true,
      min: 0,
      minExclusive: true,
      max: 10,
      step: 1,
    });
    expect(field(checks, 'ratio').constraints).toEqual({
      min: 0,
      max: 1,
      maxExclusive: true,
      step: 0.01,
    });
    expect(field(checks, 'name').constraints).toEqual({ minLength: 2, maxLength: 8 });
    expect(field(checks, 'code').constraints).toEqual({ minLength: 4, maxLength: 4 });
    expect(field(checks, 'site').constraints).toEqual({ url: true });
    expect(field(checks, 'mail').constraints).toEqual({ email: true });
    expect(field(checks, 'slug').constraints).toEqual({ regex: '^[a-z]+$' });
    expect(field(checks, 'prefixed').constraints).toBeUndefined();
  });

  it('walks the real schema with no Zod 4 type left unread', () => {
    const wrapper =
      /\b(nonoptional|prefault|default|optional|nullable|catch|readonly|pipe|transform|lazy)\b/;
    const unread = flattenTree(realTree).filter((f) =>
      wrapper.test(f.type.replace(/(enum|literal)\([^)]*\)/g, '')),
    );
    expect(unread.map((f) => `${f.path}: ${f.type}`)).toEqual([]);
    expect(realField('endpoints.azureOpenAI.groups.[].models.{}.deploymentName').type).toBe(
      'string',
    );
    expect(realField('endpoints.azureOpenAI.groups.[].group').isOptional).toBe(false);
  });
});
