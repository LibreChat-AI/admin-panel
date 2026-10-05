import { createToast } from '@clickhouse/click-ui';

/** Lets long unbroken text (dotted config paths) wrap inside the toast. */
const WRAP_CLASS = 'toast-wrap';

export const notifySuccess = (title: string): void => createToast({ type: 'success', title });

export const notifyError = (title: string): void =>
  createToast({ type: 'danger', title, className: WRAP_CLASS });

export const notifyWarning = (title: string, description?: string): void =>
  createToast({ type: 'warning', title, description, className: WRAP_CLASS });

export const notifyInfo = (title: string): void => createToast({ type: 'default', title });
