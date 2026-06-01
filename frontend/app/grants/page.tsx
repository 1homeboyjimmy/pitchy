import { Suspense } from "react";
import { GrantsPageClient } from "./GrantsPageClient";

export default function GrantsPage() {
  return (
    <Suspense fallback={null}>
      <GrantsPageClient />
    </Suspense>
  );
}
