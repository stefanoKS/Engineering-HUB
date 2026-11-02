/**
 * Application shell: session bootstrap, hash routing, navigation and the language switch.
 *
 * Sign-out and a lost session clear every cached private payload, so a shared workstation never
 * shows the previous manager's data.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Actor } from '@eh/contracts';
import { api, sessionEvents, setCsrfToken } from './api/client';
import { queryCache } from './state/cache';
import { useI18n } from './i18n';
import { MyWorkScreen } from './screens/MyWork';
import { LocalAccountsScreen, PasswordScreen } from './screens/LocalAccounts';
import { LoginScreen } from './screens/Login';
const OverviewScreen = lazy(() => import('./screens/Overview').then(module => ({ default: module.OverviewScreen })));
const ProjectsScreen = lazy(() => import('./screens/Projects').then(module => ({ default: module.ProjectsScreen })));
const ProjectDetailScreen = lazy(() => import('./screens/ProjectDetail').then(module => ({ default: module.ProjectDetailScreen })));
const TasksScreen = lazy(() => import('./screens/Tasks').then(module => ({ default: module.TasksScreen })));
const TaskDetailScreen = lazy(() => import('./screens/TaskDetail').then(module => ({ default: module.TaskDetailScreen })));
const ResponsibilitiesScreen = lazy(() => import('./screens/Responsibilities').then(module => ({ default: module.ResponsibilitiesScreen })));
const MembersScreen = lazy(() => import('./screens/Members').then(module => ({ default: module.MembersScreen })));
const MemberProfileScreen = lazy(() => import('./screens/MemberProfile').then(module => ({ default: module.MemberProfileScreen })));
const SkillsScreen = lazy(() => import('./screens/Skills').then(module => ({ default: module.SkillsScreen })));
const RequestsScreen = lazy(() => import('./screens/Requests').then(module => ({ default: module.RequestsScreen })));
const WorkloadScreen = lazy(() => import('./screens/Workload').then(module => ({ default: module.WorkloadScreen })));
const AutomationScreen = lazy(() => import('./screens/Automation').then(module => ({ default: module.AutomationScreen })));
const StatusScreen = lazy(() => import('./screens/Status').then(module => ({ default: module.StatusScreen })));
import { LanguageSwitch } from './components/ui';

export type Session = { authMode?: 'local' | 'google'; mustChangePassword?: boolean; actor: Actor; csrfToken: string; expiresAt: string };

export type Route = { path: string; segments: string[] };

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const path = hash.split('?')[0] ?? '';
  return { path: path || 'overview', segments: (path || 'overview').split('/').filter(Boolean) };
}

export function navigate(path: string): void {
  window.location.hash = `#/${path}`;
}

export function App(): JSX.Element {
  const { t, language, setLanguage } = useI18n();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(readRoute);
  const [notice, setNotice] = useState('');
  const [changingPassword,setChangingPassword] = useState(false);

  useEffect(() => {
    const onHash = (): void => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Session>('/api/session', { expectUnauthenticated: true })
      .then((value) => {
        if (cancelled) return;
        setCsrfToken(value.csrfToken);
        setSession(value);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onLost = (): void => {
      queryCache.clear();
      setCsrfToken('');
      setSession(null);
      setNotice(t('state.sessionLost'));
    };
    sessionEvents.addEventListener('session-lost', onLost);
    return () => sessionEvents.removeEventListener('session-lost', onLost);
  }, [t]);

  const signOut = useCallback(async () => {
    try {
      await api.del('/api/session');
    } catch {
      // A failed sign-out still clears local state; the server session expires on its own.
    }
    queryCache.clear();
    setCsrfToken('');
    setSession(null);
  }, []);

  const signedIn = session ? session.actor : null;
  const isManager = !!signedIn && (signedIn.role === 'ADMIN' || signedIn.role === 'MANAGER');

  const nav = useMemo(
    () =>
      [
        { path: 'overview', label: t('nav.overview') },
        { path: 'projects', label: t('nav.projects') },
        { path: 'tasks', label: t('nav.tasks') },
        { path: 'responsibilities', label: t('nav.responsibilities') },
        { path: 'members', label: t('nav.members') },
        { path: 'skills', label: t('nav.skills') },
        { path: 'requests', label: t('nav.requests') },
        { path: 'workload', label: t('nav.workload') },
        { path: 'automation', label: t('nav.automation') },
        { path: 'status', label: t('nav.status') }
      ].filter((entry) => isManager || entry.path === 'overview'),
    [t, isManager]
  );

  if (session === undefined) {
    return (
      <main className="loading-screen">
        <p>{t('state.loading')}</p>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen notice={notice} onSignedIn={(value) => {
      setCsrfToken(value.csrfToken);
      setSession(value);
      setNotice('');
    }} />;
  }

  if (session.mustChangePassword || changingPassword) return <PasswordScreen required={!!session.mustChangePassword} onChanged={()=>{setChangingPassword(false);void signOut();}} onCancel={()=>{if(session.mustChangePassword)void signOut();else setChangingPassword(false);}}/>;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{t('nav.skip')}</a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">E<span>H</span></span>
          <div><h1>{t('app.name')}</h1>
          <p className="muted">{t('app.subtitle')}</p></div>
        </div>
        <div className="header-actions">
          <LanguageSwitch language={language} onChange={setLanguage} />
          <span className="identity" title={session.actor.email}>
            {session.actor.name}
            <span className="role-pill">{session.actor.role}</span>
          </span>
          {session.authMode === 'local' && <button className="link-button" onClick={()=>setChangingPassword(true)}>{t('local.change')}</button>}
          <button type="button" className="link-button" onClick={() => void signOut()}>
            {t('nav.signOut')}
          </button>
        </div>
      </header>

      <nav className="app-nav" aria-label={t('app.name')}>
        {session.authMode === 'local' && session.actor.role === 'ADMIN' && <a className="nav-link" href="#/accounts">{t('local.accounts')}</a>}
        {nav.map((entry) => (
          <a
            key={entry.path}
            href={`#/${entry.path}`}
            aria-current={(route.segments[0] === entry.path || route.segments[0] + 's' === entry.path) ? 'page' : undefined}
            className={(route.segments[0] === entry.path || route.segments[0] + 's' === entry.path) ? 'nav-link active' : 'nav-link'}
          >
            {entry.label}
          </a>
        ))}
      </nav>

      {notice ? (
        <div className="banner warning" role="status">
          {notice}
        </div>
      ) : null}

      <main className="app-main" id="main-content" tabIndex={-1}>
        <Suspense fallback={<p role="status">{t('state.loading')}</p>}>
          <div key={route.path}>{session.authMode === 'local' && !isManager && session.actor.role === 'MEMBER' ? <MyWorkScreen/> : renderScreen(route, session.actor, isManager)}</div>
        </Suspense>
      </main>
    </div>
  );
}

function renderScreen(route: Route, actor: Actor, isManager: boolean): JSX.Element {
  if (!isManager) return <OverviewScreen actor={actor} />;
  const [first, second] = route.segments;
  switch (first) {
    case 'accounts':
      return actor.role === 'ADMIN' ? <LocalAccountsScreen/> : <OverviewScreen actor={actor}/>;
    case 'overview':
      return <OverviewScreen actor={actor} />;
    case 'projects':
      return <ProjectsScreen actor={actor} />;
    case 'project':
      return second ? <ProjectDetailScreen actor={actor} projectId={second} /> : <ProjectsScreen actor={actor} />;
    case 'tasks':
      return <TasksScreen actor={actor} />;
    case 'task':
      return second ? <TaskDetailScreen actor={actor} taskId={second} /> : <TasksScreen actor={actor} />;
    case 'responsibilities':
      return isManager ? <ResponsibilitiesScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'members':
      return <MembersScreen actor={actor} />;
    case 'member':
      return second ? <MemberProfileScreen actor={actor} memberId={second} /> : <MembersScreen actor={actor} />;
    case 'skills':
      return isManager ? <SkillsScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'requests':
      return isManager ? <RequestsScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'workload':
      return isManager ? <WorkloadScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'automation':
      return isManager ? <AutomationScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'status':
      return isManager ? <StatusScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    default:
      return <OverviewScreen actor={actor} />;
  }
}
