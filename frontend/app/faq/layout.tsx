import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Часто задаваемые вопросы (FAQ) | Pitchy.pro",
    description: "Ответы на популярные вопросы о Pitchy.pro: ИИ-анализе проектов, умном чате, дорожной карте, глубоком кастдеве, грантах и мерах поддержки.",
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
