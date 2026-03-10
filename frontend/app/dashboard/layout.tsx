import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Дашборд',
    description: 'Панель управления Pitchy.pro. Просматривайте ваши истории чатов, аналитику и отчёты по инвестиционным скорингам.',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
