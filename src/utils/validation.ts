import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import { resolveSubSchema } from './schema';

/** Validates a value against the bundled config schema at `fieldPath` (unknown paths pass). */
export function validateFieldValue(
  fieldPath: string,
  value: unknown,
): { success: true } | { success: false; error: string } {
  const segments = fieldPath.split('.');
  const subSchema = resolveSubSchema(configSchema as t.ZodSchemaLike, segments);

  if (!subSchema) return { success: true };

  if (
    typeof subSchema === 'object' &&
    'safeParse' in subSchema &&
    typeof subSchema.safeParse === 'function'
  ) {
    const result = (
      subSchema as {
        safeParse: (v: unknown) => {
          success: boolean;
          error?: { issues: Array<{ message: string; path: (string | number)[] }> };
        };
      }
    ).safeParse(value);
    if (!result.success && result.error) {
      const messages = result.error.issues.map((issue) => {
        const issuePath = issue.path.reduce(
          (path, segment) =>
            typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`,
          fieldPath,
        );
        return `${issuePath}: ${issue.message}`;
      });
      return { success: false, error: messages.join('; ') || 'Validation failed' };
    }
  }

  return { success: true };
}
