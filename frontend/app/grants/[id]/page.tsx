import { Suspense } from "react";
import { GrantDetailClient } from "./GrantDetailClient";

export default function GrantDetailPage() {
  return (
    <Suspense fallback={null}>
      <GrantDetailClient />
    </Suspense>
  );
}
