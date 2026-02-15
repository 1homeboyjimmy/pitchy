import { Suspense } from "react";
import { AccountPageClient } from "./AccountPageClient";

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountPageClient />
    </Suspense>
  );
}
