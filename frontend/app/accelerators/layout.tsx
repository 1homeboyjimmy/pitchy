import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Акселераторам — цифровое решение потока | Pitchy.pro",
  description:
    "Pitchy для акселераторов и вузов: приём заявок, матчмейкинг команд, трекинг прогресса, посещаемость по QR, глубокий аудит и экспорт к Демо-дню — единое цифровое решение вместо таблиц, форм и ручного учёта.",
  alternates: {
    canonical: "/accelerators",
  },
  openGraph: {
    url: "https://pitchy.pro/accelerators",
    title: "Акселераторам | Pitchy.pro",
    description: "Готовое цифровое решение вместо таблиц, форм и ручного учёта.",
  },
};

export default function AcceleratorsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
