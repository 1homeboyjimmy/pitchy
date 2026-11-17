import { AcceleratorTheme } from "@/components/accelerator/AcceleratorTheme";

export default function AcceleratorLayout({ children }: { children: React.ReactNode }) {
  return <AcceleratorTheme>{children}</AcceleratorTheme>;
}
