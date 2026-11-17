import React, { createContext, useContext, useEffect, useState } from 'react';
import type { LocaleCode } from '../types/domain';
import { en } from './en';
import { fa } from './fa';
import type { I18nContextValue } from './types';

const I18nContext = createContext<I18nContextValue>({
  locale: 'fa',
  dir: 'rtl',
  t: fa,
  setLocale: () => {},
});

export function I18nProvider({
  initialLocale = 'fa',
  children,
}: {
  initialLocale?: LocaleCode;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = useState<LocaleCode>(initialLocale);
  const dir: 'rtl' | 'ltr' = locale === 'fa' ? 'rtl' : 'ltr';
  const t = locale === 'fa' ? fa : en;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  return (
    <I18nContext.Provider value={{ locale, dir, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
