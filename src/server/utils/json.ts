import type * as t from '@/types';

/** The JSON body of a successful API response; a failed one throws `Failed to load <what>: <status>`. */
export async function readApiJson(response: Response, what: string): Promise<t.ConfigValue> {
  if (!response.ok) throw new Error(`Failed to load ${what}: ${response.status}`);
  return (await response.json()) as t.ConfigValue;
}
