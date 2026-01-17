import { createContext, useContext } from 'react';
import type { Language } from './i18n';

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('Language context missing');
  }
  return context;
};
