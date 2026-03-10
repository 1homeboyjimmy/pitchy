import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Часто задаваемые вопросы (FAQ) | Pitchy.pro",
    description: "Ответы на популярные вопросы о работе Pitchy.pro, ИИ-скоринге стартапов, расчете юнит-экономики и безопасности данных.",
    alternates: {
        canonical: "/faq",
    },
    openGraph: {
        url: "https://pitchy.pro/faq",
    }
};

export default function FAQLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
