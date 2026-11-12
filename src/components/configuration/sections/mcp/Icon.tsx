import { useState } from 'react';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/** Icons LibreChat can load: a web address or an image data URI (not an `${ENV}` reference). */
const LOADABLE = /^(https?:\/\/|data:image\/)/i;

/** A small preview of a server's icon (MCP-8), hidden until it loads and when it fails to. */
export function IconPreview({ src }: { src: t.ConfigValue }) {
  const localize = useLocalize();
  const [failed, setFailed] = useState<string | null>(null);
  if (typeof src !== 'string' || !LOADABLE.test(src.trim()) || failed === src) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-(--cui-color-text-muted)">
      <img
        src={src.trim()}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className="h-6 w-6 rounded-sm border border-(--cui-color-stroke-default) object-contain"
      />
      {localize('com_config_mcp_icon_preview')}
    </span>
  );
}
