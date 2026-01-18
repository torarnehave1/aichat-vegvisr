import { useEffect, useMemo, useState } from 'react';
import { LanguageSelector } from 'vegvisr-ui-kit';
import GrokChatPanel from './components/GrokChatPanel';
import { LanguageContext } from './lib/LanguageContext';
import { fetchAuthSession, loginUrl, readStoredUser, type AuthUser } from './lib/auth';
import { getStoredLanguage, setStoredLanguage } from './lib/storage';
import { useTranslation } from './lib/useTranslation';

const MAGIC_BASE = 'https://email-worker.torarnehave.workers.dev';
const DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

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

  const setAuthCookie = (token: string) => {
    if (!token) return;
    const isVegvisr = window.location.hostname.endsWith('vegvisr.org');
    const domain = isVegvisr ? '; Domain=.vegvisr.org' : '';
    const maxAge = 60 * 60 * 24 * 30;
    document.cookie = `vegvisr_token=${encodeURIComponent(
      token
    )}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${domain}`;
  };

  const persistUser = (user: {
    email: string;
    role: string;
    user_id: string | null;
    emailVerificationToken: string | null;
    oauth_id?: string | null;
    phone?: string | null;
    phoneVerifiedAt?: string | null;
    branding?: { mySite: string | null; myLogo: string | null };
    profileimage?: string | null;
  }) => {
    const payload = {
      email: user.email,
      role: user.role,
      user_id: user.user_id,
      oauth_id: user.oauth_id || user.user_id || null,
      emailVerificationToken: user.emailVerificationToken,
      phone: user.phone || null,
      phoneVerifiedAt: user.phoneVerifiedAt || null,
      branding: user.branding || { mySite: null, myLogo: null },
      profileimage: user.profileimage || null
    };
    localStorage.setItem('user', JSON.stringify(payload));
    if (user.emailVerificationToken) {
      setAuthCookie(user.emailVerificationToken);
    }
    sessionStorage.setItem('email_session_verified', '1');
    setAuthUser({
      userId: payload.user_id || payload.oauth_id || '',
      email: payload.email,
      role: payload.role || null
    });
  };

  const fetchUserContext = async (targetEmail: string) => {
    const roleRes = await fetch(
      `${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(targetEmail)}`
    );
    if (!roleRes.ok) {
      throw new Error(`User role unavailable (status: ${roleRes.status})`);
    }
    const roleData = await roleRes.json();
    if (!roleData?.role) {
      throw new Error('Unable to retrieve user role.');
    }

    const userDataRes = await fetch(
      `${DASHBOARD_BASE}/userdata?email=${encodeURIComponent(targetEmail)}`
    );
    if (!userDataRes.ok) {
      throw new Error(`Unable to fetch user data (status: ${userDataRes.status})`);
    }
    const userData = await userDataRes.json();
    return {
      email: targetEmail,
      role: roleData.role,
      user_id: userData.user_id,
      emailVerificationToken: userData.emailVerificationToken,
      oauth_id: userData.oauth_id,
      phone: userData.phone,
      phoneVerifiedAt: userData.phoneVerifiedAt,
      branding: userData.branding,
      profileimage: userData.profileimage
    };
  };

  const verifyMagicToken = async (token: string) => {
    const res = await fetch(
      `${MAGIC_BASE}/login/magic/verify?token=${encodeURIComponent(token)}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );
    const data = await res.json();
    if (!res.ok || !data.success || !data.email) {
      throw new Error(data.error || 'Invalid or expired magic link.');
    }
    const userContext = await fetchUserContext(data.email);
    persistUser(userContext);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get('magic');
    if (!magic) return;
    setAuthStatus('checking');
    verifyMagicToken(magic)
      .then(() => {
        url.searchParams.delete('magic');
        window.history.replaceState({}, '', url.toString());
        setAuthStatus('authed');
      })
      .catch(() => {
        setAuthStatus('anonymous');
      });
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
