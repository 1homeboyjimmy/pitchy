import { Providers } from "../providers";

export default function DevTokensLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
