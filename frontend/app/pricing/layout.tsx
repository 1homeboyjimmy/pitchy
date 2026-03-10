import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Тарифы и цены | Pitchy.pro",
    description: "Ознакомьтесь с тарифными планами Pitchy.pro. Выберите подходящий план для анализа стартапов и оценки инвестиционных рисков.",
    alternates: {
        canonical: "/pricing",
    },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
