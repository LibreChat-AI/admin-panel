import { createFileRoute, redirect } from '@tanstack/react-router';

/** 使用统计并入工具管理页（2.16.0）：旧链接与书签直接落到 /tools?tab=usage。 */
export const Route = createFileRoute('/_app/usage')({
  beforeLoad: () => {
    throw redirect({ to: '/tools', search: { tab: 'usage' } });
  },
});
