import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Политика конфиденциальности | Pitchy.pro',
    description: 'Ознакомьтесь с политикой конфиденциальности Pitchy.pro. Узнайте, как мы собираем, используем, храним и защищаем ваши пользовательские данные.',
    alternates: {
        canonical: '/privacy',
    },
    openGraph: {
        url: 'https://pitchy.pro/privacy',
    }
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
