import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Публичная оферта | Pitchy.pro",
    description: "Публичная оферта о заключении договора возмездного оказания услуг сервиса Pitchy.pro: предмет, акцепт, стоимость, автопродление подписки, возврат и реквизиты.",
    alternates: {
        canonical: "/offer",
    },
    openGraph: {
        url: "https://pitchy.pro/offer",
    }
};

export default function OfferLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
