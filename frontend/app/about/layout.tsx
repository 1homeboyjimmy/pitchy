import { Metadata } from "next";

export const metadata: Metadata = {
    title: "О нас | Pitchy.pro AI",
    description: "Узнайте больше о создателях Pitchy.pro, нашей миссии и технологиях искусственного интеллекта для оценки стартапов.",
    alternates: {
        canonical: "/about",
    },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
