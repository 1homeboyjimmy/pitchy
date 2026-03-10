import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Регистрация',
    description: 'Создайте аккаунт в Pitchy.pro и начните автоматизированный анализ ваших проектов с помощью ИИ.',
};

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
