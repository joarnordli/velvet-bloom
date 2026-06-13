import { createContext, useContext, useState, type ReactNode } from "react";

type Ctx = {
  discreet: boolean;
  toggle: () => void;
};

const DiscreetModeContext = createContext<Ctx | undefined>(undefined);

export function DiscreetModeProvider({ children }: { children: ReactNode }) {
  const [discreet, setDiscreet] = useState(false);
  return (
    <DiscreetModeContext.Provider value={{ discreet, toggle: () => setDiscreet((d) => !d) }}>
      {children}
    </DiscreetModeContext.Provider>
  );
}

export function useDiscreetMode() {
  const ctx = useContext(DiscreetModeContext);
  if (!ctx) throw new Error("useDiscreetMode must be used inside DiscreetModeProvider");
  return ctx;
}
