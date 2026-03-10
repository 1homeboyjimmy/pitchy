import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Создать аккаунт | Pitchy.pro AI-аналитика',
    description: 'Зарегистрируйте аккаунт в Pitchy.pro и начните автоматизированный анализ ваших проектов с помощью ИИ. Получите мгновенную оценку рисков и юнит-экономики.',
    alternates: {
        canonical: '/signup',
    },
    openGraph: {
        url: 'https://pitchy.pro/signup',
    }
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
