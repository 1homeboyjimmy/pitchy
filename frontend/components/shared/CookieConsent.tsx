import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Info } from "react-feather";
import { Button } from "./Button";
import { useAuth } from "@/lib/hooks/useAuth";
import { patchAuthJson, getMe } from "@/lib/api";

const COOKIE_CONSENT_KEY = "pitchy_cookie_consent";

export function CookieConsent() {
  const [show, setShow] = useState(false);
  const { isAuthenticated, token } = useAuth();

  useEffect(() => {
    // 1. Check local storage first (for anonymous users or fast initial render)
    const localConsent = localStorage.getItem(COOKIE_CONSENT_KEY);

    // 2. If user is authenticated, check their DB preference
    if (isAuthenticated && token) {
      getMe(token).then((user) => {
        if (user.cookie_consent === null || user.cookie_consent === undefined) {
          setShow(true);
        } else {
          // Sync DB to local storage and hide
          localStorage.setItem(COOKIE_CONSENT_KEY, user.cookie_consent ? "accepted" : "declined");
          setShow(false);
        }
      }).catch((err) => {
        console.error("Failed to fetch user profile for cookie consent:", err);
        // Fallback to local storage if API fails
        if (!localConsent) setShow(true);
      });
    } else {
      // 3. Not authenticated: rely on local storage
      if (!localConsent) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShow(true);
      }
    }
  }, [isAuthenticated, token]);

  const handleConsent = async (accepted: boolean) => {
    // Save locally
    localStorage.setItem(COOKIE_CONSENT_KEY, accepted ? "accepted" : "declined");
    setShow(false);

    // Save to DB if logged in
    if (isAuthenticated && token) {
      try {
        await patchAuthJson("/me", { cookie_consent: accepted }, token);
      } catch (err) {
        console.error("Failed to save cookie consent to DB:", err);
      }
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-8 md:bottom-8 z-[100] md:max-w-md w-auto"
        >
          <div className="bg-[#18181A] border border-white/10 shadow-2xl shadow-black/50 rounded-2xl p-4 sm:p-5">
            <div className="flex items-start gap-4">
              <div className="hidden sm:flex shrink-0 w-10 h-10 rounded-full bg-pitchy-violet/20 items-center justify-center border border-pitchy-violet/30">
                <Info className="w-5 h-5 text-pitchy-violet-light" />
              </div>
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-white text-sm sm:text-base">Использование Cookie</h3>
                  <button
                    onClick={() => setShow(false)}
                    className="text-white/40 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-white/60 text-xs sm:text-sm mb-4 leading-relaxed">
                  Мы используем файлы cookie для улучшения работы сайта и аналитики.
                  Продолжая использовать сайт, вы соглашаетесь с нашей политикой.
                </p>
                <div className="flex gap-2 sm:gap-3 flex-col sm:flex-row">
                  <Button
                    variant="primary"
                    className="flex-1 text-sm py-2 px-3"
                    onClick={() => handleConsent(true)}
                  >
                    Принять
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1 text-sm py-2 px-3"
                    onClick={() => handleConsent(false)}
                  >
                    Отклонить
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
