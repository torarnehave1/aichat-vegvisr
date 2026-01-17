import type { Language } from './i18n';

const LANGUAGE_KEY = 'vegvisr_language';

export const getStoredLanguage = (): Language => {
  const stored = localStorage.getItem(LANGUAGE_KEY);
  if (stored === 'is' || stored === 'en' || stored === 'no' || stored === 'nl') {
    return stored;
  }
  return 'en';
};

export const setStoredLanguage = (language: Language) => {
  localStorage.setItem(LANGUAGE_KEY, language);
};
