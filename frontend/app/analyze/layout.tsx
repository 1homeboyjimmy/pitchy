import { Providers } from "../providers";

export default function AnalyzeLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
