import { Suspense } from "react";
import { GrantApplicationsClient } from "./GrantApplicationsClient";

export default function GrantApplicationsPage() {
  return (
    <Suspense fallback={null}>
      <GrantApplicationsClient />
    </Suspense>
  );
}
