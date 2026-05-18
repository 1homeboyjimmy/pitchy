"use client";

import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";

/**
 * Drop-in replacements for window.alert / window.confirm that render
 * in the platform's Mantine-themed style (dark glassmorphism) instead
 * of the browser's native chrome.
 */

export function notifyInfo(message: string, title = "Pitchy") {
  notifications.show({
    title,
    message,
    color: "violet",
    autoClose: 4000,
  });
}

export function notifySuccess(message: string, title = "Готово") {
  notifications.show({
    title,
    message,
    color: "teal",
    autoClose: 4000,
  });
}

export function notifyError(message: string, title = "Ошибка") {
  notifications.show({
    title,
    message,
    color: "red",
    autoClose: 6000,
  });
}

/** Async confirm dialog. Resolves true if the user confirms, false otherwise. */
export function confirmAction(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    modals.openConfirmModal({
      title: opts.title,
      children: opts.message,
      labels: {
        confirm: opts.confirmLabel ?? "Подтвердить",
        cancel: opts.cancelLabel ?? "Отмена",
      },
      confirmProps: { color: opts.danger ? "red" : "violet" },
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
      centered: true,
    });
  });
}

/** Pretty "feature locked behind paid tier" modal with CTA to /pricing. */
export function notifyTierGate(featureName: string) {
  modals.openConfirmModal({
    title: "Доступно на платных тарифах",
    children: `Функция «${featureName}» доступна на тарифах Starter и Pro. Обновите подписку, чтобы открыть её.`,
    labels: { confirm: "Перейти к тарифам", cancel: "Не сейчас" },
    confirmProps: { color: "violet" },
    onConfirm: () => {
      if (typeof window !== "undefined") {
        window.location.href = "/pricing";
      }
    },
    centered: true,
  });
}
