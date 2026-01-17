import { useMemo, useState } from 'react';
import { LanguageSelector } from 'vegvisr-ui-kit';
import GrokChatPanel from './components/GrokChatPanel';
import { LanguageContext } from './lib/LanguageContext';
import { getStoredLanguage, setStoredLanguage } from './lib/storage';

function App() {
  const [language, setLanguageState] = useState(getStoredLanguage());

  const setLanguage = (value: typeof language) => {
    setLanguageState(value);
    setStoredLanguage(value);
  };

  const contextValue = useMemo(
    () => ({ language, setLanguage }),
    [language]
  );

  return (
    <LanguageContext.Provider value={contextValue}>
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.25),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(139,92,246,0.25),_transparent_55%)]" />
        <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-12">
          <header className="flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.4em] text-white/60">
              Vegvisr AI Chat
            </div>
            <div className="flex items-center gap-3">
              <LanguageSelector value={language} onChange={setLanguage} />
              <button
                type="button"
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 hover:bg-white/20"
              >
                Early Access
              </button>
            </div>
          </header>

          <main className="mt-16">
            <GrokChatPanel />
          </main>
        </div>
      </div>
    </LanguageContext.Provider>
  );
}

export default App
