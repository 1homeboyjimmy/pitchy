import { Metadata } from "next";
import { Providers } from "../providers";

export const metadata: Metadata = {
  title: "Контакты | Связаться с Pitchy.pro",
  description: "Свяжитесь с командой Pitchy.pro для вопросов поддержки, сотрудничества или предложений.",
  alternates: {
    canonical: "/contact",
  },
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
