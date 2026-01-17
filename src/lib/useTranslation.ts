import { useCallback } from 'react';
import { getTranslation, type Language } from './i18n';

export const useTranslation = (language: Language) => {
  return useCallback(
    (key: string) => getTranslation(language, key),
    [language]
  );
};
