"use client";

import dynamic from "next/dynamic";

const DarkVeil = dynamic(
    () => import("@/components/effects/DarkVeil").then((m) => m.DarkVeil),
    { ssr: false }
);

export function DarkVeilWrapper() {
    return <DarkVeil />;
}
