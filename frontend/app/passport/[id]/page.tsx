import { Suspense } from "react";
import { PassportOnePager } from "./PassportOnePager";

export default function PassportOnePagerPage() {
  return (
    <Suspense fallback={null}>
      <PassportOnePager />
    </Suspense>
  );
}
