import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Вход',
    description: 'Войдите в свой аккаунт Pitchy.pro, чтобы продолжить работу с вашими стартапами.',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
