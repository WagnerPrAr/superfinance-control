import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export function usePersistedState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        return JSON.parse(raw) as T;
      }
    } catch {
      // Fallback para valor padrão caso JSON inválido
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignora erro de cota do storage
    }
  }, [key, value]);

  return [value, setValue];
}
