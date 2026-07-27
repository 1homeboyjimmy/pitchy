"use client";

import { motion } from "framer-motion";

const particles = Array.from({ length: 18 }, (_, index) => {
  const angle = (index / 18) * Math.PI * 2;
  const radius = 19 + (index % 4) * 4;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.62,
    size: index % 5 === 0 ? 3 : 2,
    delay: index * -0.13,
    duration: 2.8 + (index % 4) * 0.45,
  };
});

export function ResearchActivityOrb({ compact = false }: { compact?: boolean }) {
  const size = compact ? 34 : 54;
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full border border-white/10 bg-black/45"
      style={{ width: size, height: size }}
      aria-label="Исследование выполняется"
      role="status"
    >
      <motion.div
        className="absolute inset-[22%] rounded-full bg-white/15 blur-md"
        animate={{ scale: [0.75, 1.25, 0.75], opacity: [0.35, 0.8, 0.35] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-[34%] rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,0.7)]"
        animate={{ scale: [0.8, 1.15, 0.8] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-1/2"
        animate={{ rotate: 360 }}
        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
      >
        {particles.map((particle, index) => (
          <motion.span
            key={index}
            className="absolute rounded-full bg-white"
            style={{
              width: particle.size,
              height: particle.size,
              left: particle.x,
              top: particle.y,
              opacity: 0.25 + (index % 4) * 0.16,
            }}
            animate={{
              x: [0, particle.x * -0.35, 0],
              y: [0, particle.y * -0.55, 0],
              scale: [0.65, 1.4, 0.65],
              opacity: [0.2, 0.9, 0.2],
            }}
            transition={{
              duration: particle.duration,
              delay: particle.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </motion.div>
      <motion.div
        className="absolute inset-[9%] rounded-full border border-white/10"
        animate={{ rotateX: [62, 76, 62], rotateZ: [0, 360] }}
        transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}
