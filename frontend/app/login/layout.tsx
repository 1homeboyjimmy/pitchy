import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Вход в аккаунт | Pitchy.pro AI-копилот стартапов',
    description: 'Войдите в свой аккаунт Pitchy.pro, чтобы продолжить работу с нашими инструментами автоматического анализа стартапов и расчётом инвестиционных рисков.',
    alternates: {
        canonical: '/login',
    },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
