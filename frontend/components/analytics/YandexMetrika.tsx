"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export const METRIKA_ID = 111275219;

type MetrikaParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    ym?: (counterId: number, method: string, ...args: unknown[]) => void;
  }
}

/** Sends a goal only after the product action has succeeded. */
export function trackMetrikaGoal(goal: string, params?: MetrikaParams) {
  if (typeof window === "undefined" || !window.ym) return;
  window.ym(METRIKA_ID, "reachGoal", goal, params);
}

/**
 * Next.js navigation does not reload the document. Send a hit for every
 * client-side route change so reports and Webvisor retain the current URL.
 */
export function YandexMetrika() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialPath = useRef<string | null>(null);
  const urlPath = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;

  useEffect(() => {
    if (initialPath.current === null) {
      initialPath.current = urlPath;
      return;
    }
    window.ym?.(METRIKA_ID, "hit", urlPath, {
      title: document.title,
      referrer: document.referrer,
    });
  }, [urlPath]);

  return (
    <Script id="yandex-metrika" strategy="afterInteractive">
      {`
        (function(m,e,t,r,i,k,a){
          m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
          m[i].l=1*new Date();
          for (var j=0;j<document.scripts.length;j++) { if (document.scripts[j].src===r) return; }
          k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a);
        })(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}','ym');
        ym(${METRIKA_ID},'init',{ssr:true,webvisor:true,clickmap:true,ecommerce:'dataLayer',referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});
      `}
    </Script>
  );
}
