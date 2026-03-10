import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Пользовательское соглашение | Pitchy.pro",
    description: "Условия использования сервиса Pitchy.pro и пользовательское соглашение.",
    alternates: {
        canonical: "/terms",
    },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
