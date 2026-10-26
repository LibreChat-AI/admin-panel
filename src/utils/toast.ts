import { createToast } from '@clickhouse/click-ui';

const TOAST_DURATION_MS = 2600;

export const notifySuccess = (title: string): void =>
  createToast({
    type: 'success',
    title,
    duration: TOAST_DURATION_MS,
    className: 'aimo-toast aimo-toast-success',
  });

export const notifyError = (title: string): void =>
  createToast({
    type: 'danger',
    title,
    duration: TOAST_DURATION_MS,
    className: 'aimo-toast aimo-toast-danger',
  });
