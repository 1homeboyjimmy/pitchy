"use client";

import LightRays from "./LightRays";

export function LightRaysWrapper() {
  return (
    <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden">
      <LightRays
        raysOrigin="top-center"
        raysColor="#8450c3"
        raysSpeed={1}
        lightSpread={0.5}
        rayLength={3}
        followMouse={true}
        mouseInfluence={0.1}
        noiseAmount={0}
        distortion={0}
        className="custom-rays"
        pulsating={false}
        fadeDistance={1}
        saturation={1}
      />
    </div>
  );
}
