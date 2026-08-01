import { Providers } from "../providers";

export default function PassportLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
