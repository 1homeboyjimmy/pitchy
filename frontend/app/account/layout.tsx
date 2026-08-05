import { Providers } from "../providers";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
