"use client";

import { motion } from "framer-motion";
import { forwardRef } from "react";

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  ({ label, error, icon, className = "", ...props }, ref) => {
    return (
      <div className="w-full">
        {label ? (
          <label className="block text-sm font-medium text-zinc-400 mb-2 leading-normal">
            {label}
          </label>
        ) : null}

        <motion.div
          className="relative group w-full isolate"
          whileFocus={{ scale: 1.01 }}
        >
          {/* Background Layer */}
          <div className={`
            absolute inset-0 rounded-xl
            bg-zinc-900/50 backdrop-blur-xl border border-zinc-800
            group-focus-within:border-violet-500/50 group-focus-within:ring-2 group-focus-within:ring-violet-500/20
            transition-all duration-200 pointer-events-none
            ${error ? "border-red-500/50 ring-2 ring-red-500/20" : ""}
          `} />

          <div className="relative flex items-center z-10">
            {icon ? (
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none drop-shadow-sm z-20">
                {icon}
              </div>
            ) : null}
            <input
              ref={ref}
              className={`
                w-full bg-transparent text-white placeholder-zinc-500
                py-3 px-4 rounded-xl outline-none leading-normal
                ${icon ? "!pl-12" : ""}
                ${className}
              `}
              {...props}
            />
          </div>
        </motion.div>
        {error ? (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1 text-sm text-red-400"
          >
            {error}
          </motion.p>
        ) : null}
      </div>
    );
  }
);

InputField.displayName = "InputField";
