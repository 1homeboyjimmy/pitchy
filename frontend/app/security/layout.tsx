import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Безопасность и защита данных | Pitchy.pro',
    description: 'Pitchy.pro обеспечивает строгую безопасность данных ваших стартапов. Узнайте о нашем шифровании, инфраструктуре и соответствии стандартам 152-ФЗ.',
    alternates: {
        canonical: '/security',
    },
    openGraph: {
        url: 'https://pitchy.pro/security',
    }
};

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
