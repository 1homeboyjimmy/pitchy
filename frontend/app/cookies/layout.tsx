import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Использование файлов Cookie | Pitchy.pro',
    description: 'Политика использования файлов Cookie (куки) на платформе Pitchy.pro. Узнайте, какие технические и аналитические данные мы обрабатываем и как ими управлять.',
    alternates: {
        canonical: '/cookies',
    },
    openGraph: {
        url: 'https://pitchy.pro/cookies',
    }
};

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
