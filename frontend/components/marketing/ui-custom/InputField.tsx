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
          className={`
            relative flex items-center
            bg-zinc-900/50 border border-zinc-800 rounded-xl
            focus-within:border-violet-500/50 focus-within:ring-2 focus-within:ring-violet-500/20
            transition-all duration-200
            ${error ? "border-red-500/50 ring-2 ring-red-500/20" : ""}
          `}
          whileFocus={{ scale: 1.01 }}
        >
          {icon ? <div className="absolute left-4 text-zinc-500">{icon}</div> : null}
          <input
            ref={ref}
            className={`
              w-full bg-transparent text-white placeholder-zinc-500
              py-3 px-4 rounded-xl outline-none leading-normal
              ${icon ? "pl-12" : ""}
              ${className}
            `}
            {...props}
          />
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
