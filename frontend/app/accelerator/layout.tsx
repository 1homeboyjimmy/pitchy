import { AcceleratorTheme } from "@/components/accelerator/AcceleratorTheme";
import { Providers } from "../providers";

export default function AcceleratorLayout({ children }: { children: React.ReactNode }) {
  return <Providers><AcceleratorTheme>{children}</AcceleratorTheme></Providers>;
}
