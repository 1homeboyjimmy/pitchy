import { ApiError, describeApiError } from "@/lib/api";

export function describeProjectAuditLaunchError(error: unknown): string {
  if (error instanceof ApiError && error.status === 402) {
    return "Исчерпан месячный лимит аудитов этого потока. Главный администратор может увеличить его в разделе «Настройки → Лимиты».";
  }
  return describeApiError(error, "Не удалось запустить аудит");
}
