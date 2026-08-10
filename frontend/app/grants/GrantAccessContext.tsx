"use client";

import { createContext, useContext } from "react";

type GrantAccessState = {
  loading: boolean;
  canUseGrantActions: boolean;
};

const GrantAccessContext = createContext<GrantAccessState>({
  loading: true,
  canUseGrantActions: false,
});

export function GrantAccessProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: GrantAccessState;
}) {
  return <GrantAccessContext.Provider value={value}>{children}</GrantAccessContext.Provider>;
}

export function useGrantAccess() {
  return useContext(GrantAccessContext);
}
