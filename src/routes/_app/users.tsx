import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/users')({
  head: () => ({ meta: [{ title: 'AIMO · Chat Admin Panel · User management' }] }),
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
  component: () => null,
});
