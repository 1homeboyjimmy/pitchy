import type { Metadata } from 'next';
import { Providers } from '../providers';

export const metadata: Metadata = {
    title: 'Дашборд инвестора | Управление проектами Pitchy.pro',
    description: 'Панель управления Pitchy.pro. Создавайте новые ИИ-анализы, пересматривайте истории чатов, изучайте аналитику и выгружайте готовые инвестиционные скоринги.',
    alternates: {
        canonical: '/dashboard',
    },
    openGraph: {
        url: 'https://pitchy.pro/dashboard',
    }
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <Providers>{children}</Providers>;
}
