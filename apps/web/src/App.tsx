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
const WorkProjectsScreen = lazy(() => import('./screens/WorkProjects').then(module => ({ default: module.WorkProjectsScreen })));
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
import { recordRoute, rememberScroll, rememberedScroll } from './state/navigation';

export type Session = { authMode?: 'local' | 'google'; mustChangePassword?: boolean; actor: Actor; csrfToken: string; expiresAt: string };

export type Route = { path: string; segments: string[]; search: string; location: string };

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [rawPath = '', search = ''] = hash.split('?', 2);
  const path = rawPath || 'overview';
  return {
    path,
    segments: path.split('/').filter(Boolean),
    search,
    location: `${path}${search ? `?${search}` : ''}`
  };
}

export function navigate(path: string): void {
  window.location.hash = `#/${path}`;
}

export function App(): JSX.Element {
  const { t, language, setLanguage } = useI18n();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(() => {
    const initial = readRoute();
    recordRoute(initial.location);
    return initial;
  });
  const [notice, setNotice] = useState('');
  const [changingPassword,setChangingPassword] = useState(false);

  useEffect(() => {
    const onHash = (): void => {
      const next = readRoute();
      recordRoute(next.location);
      setRoute(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, rememberedScroll(route.path)));
    return () => {
      window.cancelAnimationFrame(frame);
      rememberScroll(route.path, window.scrollY);
    };
  }, [route.path]);

  // A member or viewer never lands on a manager-only route, even if the address bar still holds
  // one from a previous administrator session on a shared workstation.
  useEffect(() => {
    const role = session?.actor.role;
    if (!role || role === 'ADMIN' || role === 'MANAGER') return;
    const allowed = new Set(['my-work', 'all-work', 'overview', 'task', 'projects', 'project']);
    if (!allowed.has(route.segments[0] ?? 'overview')) navigate('my-work');
  }, [session, route.path]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Session>('/api/session', { expectUnauthenticated: true })
      .then((value) => {
        if (cancelled) return;
        setCsrfToken(value.csrfToken);
        setSession(value);
        // A member or a viewer lands on their own work; managers land on the overview.
        if (!window.location.hash && (value.actor.role === 'MEMBER' || value.actor.role === 'VIEWER')) {
          navigate('my-work');
        }
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

  const navGroups = useMemo(() => {
    const all = [
      { path: 'overview', label: t('nav.overview'), group: 'nav.group.myWork' },
      { path: 'my-work', label: t('local.myWork'), group: 'nav.group.myWork' },
      { path: 'all-work', label: t('nav.allWork'), group: 'nav.group.department' },
      { path: 'projects', label: t('nav.projects'), group: 'nav.group.department' },
      { path: 'responsibilities', label: t('nav.responsibilities'), group: 'nav.group.department' },
      { path: 'requests', label: t('nav.requests'), group: 'nav.group.department' },
      { path: 'members', label: t('nav.members'), group: 'nav.group.people' },
      { path: 'skills', label: t('nav.skills'), group: 'nav.group.people' },
      { path: 'workload', label: t('nav.workload'), group: 'nav.group.people' },
      { path: 'automation', label: t('nav.automation'), group: 'nav.group.admin' },
      { path: 'status', label: t('nav.status'), group: 'nav.group.admin' }
    ].filter((entry) =>
      isManager
        ? true
        : entry.path === 'my-work' || entry.path === 'all-work' || entry.path === 'projects' || entry.path === 'overview'
    );
    // Frequent destinations stay directly reachable; grouping only adds a heading, never a menu.
    return ['nav.group.myWork', 'nav.group.department', 'nav.group.people', 'nav.group.admin'].map((group) => ({
      label: t(group),
      entries: all.filter((entry) => entry.group === group)
    }));
  }, [t, isManager]);

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
          <img src="/branding/designTeam.png" alt="広島化成 製品設計課" className="design-team-logo" />
          <div className="brand-text"><h1>{t('app.name')}</h1>
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
        {navGroups.map((group) =>
          group.entries.length === 0 ? null : (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.entries.map((entry) => (
                <a
                  key={entry.path}
                  href={`#/${entry.path}`}
                  aria-current={(route.segments[0] === entry.path || route.segments[0] + 's' === entry.path) ? 'page' : undefined}
                  className={(route.segments[0] === entry.path || route.segments[0] + 's' === entry.path) ? 'nav-link active' : 'nav-link'}
                >
                  {entry.label}
                </a>
              ))}
              {group.label === t('nav.group.admin') && session.authMode === 'local' && session.actor.role === 'ADMIN' ? (
                <a className="nav-link" href="#/accounts">
                  {t('local.accounts')}
                </a>
              ) : null}
            </div>
          )
        )}
      </nav>

      {notice ? (
        <div className="banner warning" role="status">
          {notice}
        </div>
      ) : null}

      <main className="app-main" id="main-content" tabIndex={-1}>
        <Suspense key={route.location} fallback={<p role="status">{t('state.loading')}</p>}>
          <div>{renderScreen(route, session.actor, isManager)}</div>
        </Suspense>
      </main>
    </div>
  );
}

function renderScreen(route: Route, actor: Actor, isManager: boolean): JSX.Element {
  const [first, second] = route.segments;
  // Every signed-in role keeps a personal work list; only a MEMBER may create or request from it.
  if (first === 'my-work') return <MyWorkScreen actor={actor} />;
  // All Work is the same read-only list for MEMBER and VIEWER, and the management list otherwise.
  if (first === 'all-work' || first === 'tasks') {
    return <TasksScreen actor={actor} readOnly={!isManager} routeSearch={route.search} />;
  }
  if (first === 'task') {
    if (!second) return <TasksScreen actor={actor} readOnly={!isManager} />;
    return <TaskDetailScreen actor={actor} taskId={second} readOnly={!isManager} />;
  }
  // MEMBER and VIEWER browse permitted projects through the read-only explorer, never through the
  // management list (which reads `/api/manager/projects`).
  if (first === 'projects' && !isManager) return <WorkProjectsScreen />;
  // Read-only project detail stays reachable for MEMBER and VIEWER (the task detail links here).
  if (first === 'project' && second && !isManager) {
    return <ProjectDetailScreen actor={actor} projectId={second} readOnly />;
  }
  if (!isManager) return <OverviewScreen actor={actor} />;
  switch (first) {
    case 'accounts':
      return actor.role === 'ADMIN' ? <LocalAccountsScreen /> : <OverviewScreen actor={actor} />;
    case 'overview':
      return <OverviewScreen actor={actor} />;
    case 'projects':
      return <ProjectsScreen actor={actor} />;
    case 'project':
      return second ? <ProjectDetailScreen actor={actor} projectId={second} /> : <ProjectsScreen actor={actor} />;
    case 'responsibilities':
      return <ResponsibilitiesScreen actor={actor} />;
    case 'members':
      return <MembersScreen actor={actor} />;
    case 'member':
      return second ? <MemberProfileScreen actor={actor} memberId={second} /> : <MembersScreen actor={actor} />;
    case 'skills':
      return <SkillsScreen actor={actor} />;
    case 'requests':
      return <RequestsScreen actor={actor} />;
    case 'workload':
      return <WorkloadScreen actor={actor} />;
    case 'automation':
      return <AutomationScreen actor={actor} />;
    case 'status':
      return <StatusScreen actor={actor} />;
    default:
      return <OverviewScreen actor={actor} />;
  }
}
