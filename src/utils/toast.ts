import { createToast } from '@clickhouse/click-ui';

export const notifySuccess = (title: string): void => createToast({ type: 'success', title });

export const notifyError = (title: string): void => createToast({ type: 'danger', title });

export const notifyWarning = (title: string): void => createToast({ type: 'warning', title });

export const notifyInfo = (title: string): void => createToast({ type: 'default', title });
