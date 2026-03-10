import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Пользовательское соглашение | Pitchy.pro",
    description: "Официальные условия использования сервиса Pitchy.pro и пользовательское соглашение. Ознакомьтесь с правилами работы с нашей AI-платформой.",
    alternates: {
        canonical: "/terms",
    },
    openGraph: {
        url: "https://pitchy.pro/terms",
    }
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
