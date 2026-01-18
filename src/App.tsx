import { useEffect, useMemo, useState } from 'react';
import { LanguageSelector } from 'vegvisr-ui-kit';
import GrokChatPanel from './components/GrokChatPanel';
import { LanguageContext } from './lib/LanguageContext';
import { fetchAuthSession, loginUrl, readStoredUser, type AuthUser } from './lib/auth';
import { getStoredLanguage, setStoredLanguage } from './lib/storage';
import { useTranslation } from './lib/useTranslation';

function App() {
  const [language, setLanguageState] = useState(getStoredLanguage());
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'anonymous'>('checking');

  const setLanguage = (value: typeof language) => {
    setLanguageState(value);
    setStoredLanguage(value);
  };

  const contextValue = useMemo(
    () => ({ language, setLanguage }),
    [language]
  );
  const t = useTranslation(language);

  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get('magic');
    if (!magic) return;
    url.searchParams.delete('magic');
    const redirectTarget = url.toString();
    const loginWithMagic = `https://login.vegvisr.org?magic=${encodeURIComponent(
      magic
    )}&redirect=${encodeURIComponent(redirectTarget)}`;
    window.location.replace(loginWithMagic);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      const stored = readStoredUser();
      if (stored && isMounted) {
        setAuthUser(stored);
      }
      try {
        const session = await fetchAuthSession();
        if (session && isMounted) {
          setAuthUser(session);
          setAuthStatus('authed');
          return;
        }
      } catch {
        // ignore and fall back to stored user if present
      }
      if (isMounted) {
        setAuthStatus(stored ? 'authed' : 'anonymous');
      }
    };
    bootstrap();
    return () => {
      isMounted = false;
    };
  }, []);

  const loginHref = loginUrl(window.location.href);

  return (
    <LanguageContext.Provider value={contextValue}>
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.25),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(139,92,246,0.25),_transparent_55%)]" />
        <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-12">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm font-semibold uppercase tracking-[0.4em] text-white/60">
              {t('app.title')}
            </div>
            <div className="flex items-center gap-3">
              <LanguageSelector value={language} onChange={setLanguage} />
              {authStatus === 'anonymous' ? (
                <a
                  href={loginHref}
                  className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 hover:bg-white/20"
                >
                  Sign in
                </a>
              ) : (
                <button
                  type="button"
                  className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 hover:bg-white/20"
                >
                  {t('app.badge')}
                </button>
              )}
            </div>
          </header>

          {authStatus === 'checking' && (
            <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-white/70">
              Checking session...
            </div>
          )}

          {authStatus === 'anonymous' && (
            <div className="mt-10 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-6 py-4 text-sm text-rose-100">
              You are not signed in. Click “Sign in” to continue.
            </div>
          )}

          <main className="mt-16">
            <GrokChatPanel
              initialUserId={authUser?.userId}
              initialEmail={authUser?.email}
            />
          </main>
        </div>
      </div>
    </LanguageContext.Provider>
  );
}

export default App
