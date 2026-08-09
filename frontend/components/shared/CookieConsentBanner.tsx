"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { getMe, patchAuthJson } from "@/lib/api";
import {
  clearYandexAnalyticsCookies,
  getCookieConsent,
  migrateLegacyCookieConsent,
  setCookieConsent,
  subscribeCookieConsent,
  type CookieConsentChoice,
} from "@/lib/cookieConsent";
import { useAuth } from "@/lib/hooks/useAuth";

export function CookieConsentBanner() {
  const { isAuthenticated, isLoaded, token } = useAuth();
  const choice = useSyncExternalStore(
    subscribeCookieConsent,
    getCookieConsent,
    () => "unknown" as CookieConsentChoice,
  );

  useEffect(() => {
    migrateLegacyCookieConsent();
  }, []);

  useEffect(() => {
    if (!isLoaded || !isAuthenticated || !token) return;
    let cancelled = false;

    getMe(token)
      .then(async (user) => {
        if (cancelled) return;
        const localChoice = getCookieConsent();

        // Локальный выбор приоритетен: отказ нельзя затереть настройкой профиля.
        if (localChoice !== "unknown") {
          const accepted = localChoice === "accepted";
          if (user.cookie_consent !== accepted) {
            await patchAuthJson("/me", { cookie_consent: accepted }, token);
          }
          return;
        }

        if (user.cookie_consent !== null && user.cookie_consent !== undefined) {
          setCookieConsent(user.cookie_consent ? "accepted" : "necessary");
        }
      })
      .catch(() => {
        // Локальный выбор продолжает действовать при недоступности профиля.
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoaded, token]);

  const choose = async (nextChoice: "accepted" | "necessary") => {
    const storedChoice =
      choice === "accepted" && nextChoice === "necessary" ? "revoked" : nextChoice;

    setCookieConsent(storedChoice);
    if (nextChoice === "necessary") clearYandexAnalyticsCookies();

    if (isAuthenticated && token) {
      try {
        await patchAuthJson("/me", { cookie_consent: nextChoice === "accepted" }, token);
      } catch {
        // Выбор применяется сразу, даже если синхронизация профиля не удалась.
      }
    }
  };

  // После выбора баннер полностью исчезает. Настройки cookie доступны через
  // страницу политики, а плавающая кнопка больше не перекрывает интерфейс.
  if (choice !== "unknown") return null;

  return (
    <section
      role="dialog"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-3 bottom-3 z-[300] mx-auto max-w-3xl rounded-2xl border border-white/15 bg-[#0a0a0a]/95 p-4 text-white shadow-2xl backdrop-blur-xl sm:bottom-5 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <h2 id="cookie-consent-title" className="text-sm font-semibold sm:text-base">
            Настройки cookie
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-white/60 sm:text-sm">
            Необходимые cookie обеспечивают вход и работу сервиса. Яндекс Метрика,
            Вебвизор и аналитические cookie включаются только с вашего согласия. Подробнее — в{" "}
            <Link href="/cookies" className="text-white underline underline-offset-2">
              политике cookie
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 min-[420px]:flex-row">
          <button
            type="button"
            onClick={() => void choose("necessary")}
            className="rounded-full border border-white/20 px-4 py-2.5 text-xs font-medium text-white/75 transition-colors hover:border-white/40 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Только необходимые
          </button>
          <button
            type="button"
            onClick={() => void choose("accepted")}
            className="rounded-full bg-white px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Принять аналитику
          </button>
        </div>
      </div>
    </section>
  );
}
