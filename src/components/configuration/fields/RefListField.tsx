import type * as t from '@/types';
import { useOptionSources } from '@/hooks';
import { ListField } from './ListField';

/**
 * A list of references to other configured things (`agents.allowedProviders`
 * → endpoints, a spec's MCP servers): items are picked from
 * `useOptionSources`, so a typo cannot slip in. Values the source does not
 * know are kept and shown as they are.
 */
export function RefListField({ source, ...props }: t.RefListFieldProps) {
  const { options } = useOptionSources(source);
  return <ListField {...props} options={options} />;
}
