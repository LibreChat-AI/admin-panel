import { cn } from '@/utils';

/** 行内小操作按钮（工具清单/工具分组/服务管理统一样式，2.19.0 平铺替代三点菜单）。 */
export function InlineAction({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'rounded-md border border-(--cui-color-stroke-default) px-1.5 py-0.5 text-xs leading-5 text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover)',
        danger ? 'hover:text-(--cui-color-text-danger)' : 'hover:text-(--cui-color-text-default)',
      )}
    >
      {children}
    </button>
  );
}
