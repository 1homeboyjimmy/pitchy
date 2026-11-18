import { ApiError, describeApiError } from "@/lib/api";

export function describeProjectAuditLaunchError(error: unknown): string {
  if (error instanceof ApiError && error.status === 402) {
    return "Исчерпан лимит сообщений резидента в этом потоке. Главный администратор может увеличить его в разделе «Лимиты».";
  }
  return describeApiError(error, "Не удалось запустить аудит");
}
