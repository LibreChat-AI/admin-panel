import { z } from 'zod';
import yaml from 'js-yaml';
import { configSchema } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type * as t from '@/types';
import { BLOCK_UNSAFE_CONFIG_KEYS, UNSAFE_CONFIG_KEY_MESSAGE } from '@/constants';
import { flattenObject, findUnsafeKeys, resolveSubSchema } from '@/utils';

/** Leaf paths of `raw` that the bundled config schema does not describe. */
export function findUnknownConfigPaths(raw: Record<string, t.ConfigValue>): string[] {
  return Object.keys(flattenObject(raw)).filter(
    (path) => resolveSubSchema(configSchema as t.ZodSchemaLike, path.split('.')) == null,
  );
}

/**
 * Parses and validates pasted/uploaded YAML for import. Validation runs on a
 * copy with `version` replaced (a snippet need not carry it, and import never
 * writes it, so `version: 1.2` read as a number must not fail), but the result
 * is the raw parsed object: no Zod defaults are injected and keys the bundled
 * schema does not know are kept (and reported in `unknownPaths`).
 */
export function parseConfigYaml(yamlContent: string): t.ImportParseResult {
  const failure = (
    error: string,
    validationErrors?: t.ImportValidationError[],
  ): t.ImportParseResult => ({
    success: false,
    error,
    validationErrors,
    appConfig: null,
    unknownPaths: [],
  });

  let rawConfig: unknown;
  try {
    rawConfig = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
  } catch (parseError) {
    const mark = (parseError as { mark?: { line: number; column: number } }).mark;
    const where = mark ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : '';
    return failure(`Invalid YAML syntax${where}. Please check the content for syntax errors.`);
  }

  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return failure('YAML did not produce a valid configuration object');
  }

  const appConfig = rawConfig as t.ConfigRecord;
  const result = configSchema.safeParse({ ...appConfig, version: '1.0.0' });
  if (!result.success) {
    return failure(
      'Config validation failed',
      result.error.errors.map((e: { path: (string | number)[]; message: string }) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    );
  }

  if (BLOCK_UNSAFE_CONFIG_KEYS) {
    const unsafe = findUnsafeKeys(appConfig, '');
    if (unsafe.length > 0) {
      return failure(
        'Some keys cannot be imported',
        unsafe.map(({ path, key }) => ({
          path: path || key,
          message: `"${key}": ${UNSAFE_CONFIG_KEY_MESSAGE}`,
        })),
      );
    }
  }

  return {
    success: true,
    error: undefined,
    validationErrors: undefined,
    appConfig,
    unknownPaths: findUnknownConfigPaths(appConfig),
  };
}

export const parseImportedYaml = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ yamlContent: z.string() }))
  .handler(async ({ data }: { data: { yamlContent: string } }) =>
    parseConfigYaml(data.yamlContent),
  );
