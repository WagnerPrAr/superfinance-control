import { createContext, useContext } from 'react';

export const PrivacyContext = createContext<boolean>(false);

export function usePrivacyMode(): boolean {
  return useContext(PrivacyContext);
}
