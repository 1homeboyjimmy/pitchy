import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Подтверждение почты | Pitchy.pro',
    description: 'Введите код подтверждения, отправленный на вашу электронную почту.',
    alternates: {
        canonical: '/verify',
    },
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
