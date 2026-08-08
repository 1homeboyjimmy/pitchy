export const COOKIE_CONSENT_STORAGE_KEY = "pitchy_cookie_consent_v2";
export const COOKIE_CONSENT_EVENT = "pitchy:cookie-consent";

const LEGACY_STORAGE_KEYS = ["pitchy_cookie_consent_v1", "pitchy_cookie_consent"] as const;

let memoryChoice: CookieConsentChoice = "unknown";

export type CookieConsentChoice = "unknown" | "accepted" | "necessary" | "revoked";
type StoredConsent = { choice: Exclude<CookieConsentChoice, "unknown">; updatedAt: string };

function parseStoredConsent(raw: string | null): CookieConsentChoice {
  if (!raw) return "unknown";
  if (raw === "accepted") return "accepted";
  if (raw === "declined") return "necessary";
  try {
    const choice = (JSON.parse(raw) as Partial<StoredConsent>).choice;
    return choice === "accepted" || choice === "necessary" || choice === "revoked"
      ? choice
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function getCookieConsent(): CookieConsentChoice {
  if (typeof window === "undefined") return "unknown";
  try {
    const current = parseStoredConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
    if (current !== "unknown") {
      memoryChoice = current;
      return current;
    }
    for (const key of LEGACY_STORAGE_KEYS) {
      const migrated = parseStoredConsent(window.localStorage.getItem(key));
      if (migrated !== "unknown") {
        memoryChoice = migrated;
        return migrated;
      }
    }
  } catch {
    // Storage can be unavailable in privacy mode; keep the current-page choice.
  }
  return memoryChoice;
}

export function migrateLegacyCookieConsent(): void {
  if (typeof window === "undefined") return;
  try {
    if (parseStoredConsent(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)) !== "unknown") {
      return;
    }
    for (const key of LEGACY_STORAGE_KEYS) {
      const migrated = parseStoredConsent(window.localStorage.getItem(key));
      if (migrated !== "unknown") {
        setCookieConsent(migrated);
        return;
      }
    }
  } catch {
    // No migration is possible when storage is unavailable.
  }
}

export function hasAnalyticsCookieConsent(): boolean {
  return getCookieConsent() === "accepted";
}

export function setCookieConsent(choice: Exclude<CookieConsentChoice, "unknown">): void {
  if (typeof window === "undefined") return;
  memoryChoice = choice;
  const value: StoredConsent = { choice, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(value));
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // The custom event still applies the choice to the current page.
  }
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: value }));
}

export function subscribeCookieConsent(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key === COOKIE_CONSENT_STORAGE_KEY || LEGACY_STORAGE_KEYS.some((key) => key === event.key)) {
      onChange();
    }
  };
  window.addEventListener(COOKIE_CONSENT_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(COOKIE_CONSENT_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function clearYandexAnalyticsCookies(): void {
  if (typeof document === "undefined") return;
  const names = document.cookie
    .split(";")
    .map((part) => part.split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name))
    .filter((name) => name.startsWith("_ym_") || name === "_ym_uid" || name === "_ym_d");
  const domains = ["", window.location.hostname, ".pitchy.pro"];
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}; SameSite=Lax`;
    }
  }
}
