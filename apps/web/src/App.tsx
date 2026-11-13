/**
 * Application shell: session bootstrap, hash routing, navigation and the language switch.
 *
 * Sign-out and a lost session clear every cached private payload, so a shared workstation never
 * shows the previous manager's data.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Actor } from '@eh/contracts';
import { api, ApiFailure, sessionEvents, setCsrfToken } from './api/client';
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
const DivisionsScreen = lazy(() => import('./screens/Divisions').then(module => ({ default: module.DivisionsScreen })));
const DeletedItemsScreen = lazy(() => import('./screens/DeletedItems').then(module => ({ default: module.DeletedItemsScreen })));
const StatusScreen = lazy(() => import('./screens/Status').then(module => ({ default: module.StatusScreen })));
const TimelineScreen = lazy(() => import('./screens/Timeline').then(module => ({ default: module.TimelineScreen })));
import { LanguageSwitch, Menu } from './components/ui';
import { DivisionScopeBar } from './components/DivisionScopeBar';
import { SubmissionNotices } from './components/submission-notices';
import { clearDivisionScope, setDivisionScope } from './state/division';
import { recordRoute, rememberScroll, rememberedScroll, resetRouteMemory, routeAllowed } from './state/navigation';
import { clearSubmissions } from './state/submissions';
import { useBusinessDateRefresh } from './state/business-date';

export type SessionDivision = { divisionId: string; name: string; status: string };
export type Session = {
  authMode?: 'local' | 'google';
  mustChangePassword?: boolean;
  actor: Actor;
  /** The divisions this session may read and write; a display aid, never authority. */
  divisions?: {
    readable: SessionDivision[];
    writable: SessionDivision[];
    allDivisions: boolean;
    defaultDivisionId: string | null;
  };
  csrfToken: string;
  expiresAt: string;
};

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
  // A page left open across the Tokyo day boundary re-reads its date-dependent answers once.
  useBusinessDateRefresh();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(() => {
    const initial = readRoute();
    recordRoute(initial.location);
    return initial;
  });
  const [notice, setNotice] = useState('');
  const [startupNotice, setStartupNotice] = useState('');
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
    if (!session) return;
    if (!routeAllowed(route.path, session.actor)) navigate('my-work');
  }, [session, route.path]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Session>('/api/session', { expectUnauthenticated: true })
      .then((value) => {
        if (cancelled) return;
        setCsrfToken(value.csrfToken);
        if (value.divisions) setDivisionScope(value.divisions);
        setSession(value);
        setStartupNotice('');
        // A member or a viewer lands on their own work; managers land on the overview.
        if (!window.location.hash && (value.actor.role === 'MEMBER' || value.actor.role === 'VIEWER')) {
          navigate('my-work');
        }
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setSession(null);
        // A lost session is normal; a readiness or configuration failure is not, and the sign-in
        // screen must say so instead of implying that the credentials were wrong.
        const code = failure instanceof ApiFailure ? failure.code : '';
        if (code === 'DATABASE_MIGRATION_REQUIRED') setStartupNotice(t('login.readinessRequired'));
        else if (code && code !== 'UNAUTHENTICATED') setStartupNotice(t('state.unavailable'));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const onLost = (): void => {
      queryCache.clear();
      setCsrfToken('');
      setSession(null);
      clearDivisionScope();
      clearSubmissions();
      resetRouteMemory();
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
    clearDivisionScope();
    clearSubmissions();
    // Navigation memory belongs to the session that just ended: no filter, selection, expanded
    // branch or scroll position may be inherited by the next user of this workstation.
    resetRouteMemory();
  }, []);

  const signedIn = session ? session.actor : null;
  const isManager = !!signedIn && (signedIn.role === 'ADMIN' || signedIn.role === 'MANAGER');
  const desktop = useDesktopNavigation();
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // The navigation groups follow the operating rhythm of the department: daily work first, then the
  // people and area material a manager consults, then the administration screens.
  const navGroups = useMemo(() => {
    const all = [
      { path: 'overview', label: t('nav.overview'), group: 'daily' },
      { path: 'my-work', label: t('local.myWork'), group: 'daily' },
      { path: 'all-work', label: t('nav.allWork'), group: 'daily' },
      { path: 'projects', label: t('nav.projects'), group: 'daily' },
      { path: 'timeline', label: t('nav.timeline'), group: 'daily' },
      { path: 'requests', label: t('nav.requests'), group: 'daily' },
      { path: 'responsibilities', label: t('nav.responsibilities'), group: 'team' },
      { path: 'members', label: t('nav.members'), group: 'team' },      { path: 'skills', label: t('nav.skills'), group: 'team' },
      { path: 'workload', label: t('nav.workload'), group: 'team' },
      { path: 'automation', label: t('nav.automation'), group: 'management' },
      { path: 'status', label: t('nav.status'), group: 'management' }
    ].filter((entry) =>
      isManager
        ? true
        : entry.path === 'my-work' ||
          entry.path === 'all-work' ||
          entry.path === 'projects' ||
          entry.path === 'timeline' ||
          entry.path === 'overview'
    );
    // Local account administration is an ADMIN screen in local mode only; its visibility is the
    // same rule the route itself enforces.
    if (isManager && signedIn?.role === 'ADMIN' && session?.authMode === 'local') {
      all.push({ path: 'accounts', label: t('local.accounts'), group: 'management' });
    }
    // Divisions are administrator-managed data, so the screen is ADMIN only and the route re-checks.
    if (signedIn?.role === 'ADMIN') {
      all.push({ path: 'divisions', label: t('division.manage'), group: 'management' });

    }
    if (isManager) all.push({ path: 'deleted-items', label: t('nav.deletedItems'), group: 'management' });
    const headings: Record<string, string> = {
      daily: t('nav.group.daily'),
      team: t('nav.group.team'),
      management: t('nav.group.management')
    };
    // A group with no visible destination is not rendered at all.
    return ['daily', 'team', 'management']
      .map((group) => ({ key: group, label: headings[group], entries: all.filter((entry) => entry.group === group) }))
      .filter((group) => group.entries.length > 0);
  }, [t, isManager, signedIn?.role, session?.authMode]);

  // A drawer closes as soon as the destination changes; the route remains the single source of
  // truth for the active entry, the deep link and the Back behaviour.
  useEffect(() => {
    setNavOpen(false);
  }, [route.location]);

  // While the drawer is open it owns the keyboard: focus enters it, Tab stays inside it, Escape
  // dismisses it and focus returns to the control that opened it. The rest of the page is inert
  // for assistive technology while the drawer is a modal surface.
  useEffect(() => {
    if (!navOpen) return undefined;
    const drawer = document.getElementById('app-navigation');
    const focusables = (): HTMLElement[] =>
      drawer
        ? [...drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
            (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true'
          )
        : [];
    const first = focusables()[0];
    first?.focus();
    const siblingSurfaces = [document.querySelector<HTMLElement>('.app-header'), document.querySelector<HTMLElement>('.app-main')]
      .filter((element): element is HTMLElement => !!element);
    for (const surface of siblingSurfaces) surface.setAttribute('inert', '');
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === firstItem || !drawer?.contains(active))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (active === lastItem || !drawer?.contains(active))) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const surface of siblingSurfaces) surface.removeAttribute('inert');
    };
  }, [navOpen]);

  // A resize to the desktop layout replaces the drawer with the sidebar; the drawer state is
  // dropped so no invisible overlay keeps focus or an inert background behind.
  useEffect(() => {
    if (desktop && navOpen) setNavOpen(false);
  }, [desktop, navOpen]);

  const closeDrawer = useCallback(() => {
    setNavOpen(false);
    menuButtonRef.current?.focus();
  }, []);

  if (session === undefined) {
    return (
      <main className="loading-screen">
        <p>{t('state.loading')}</p>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen notice={notice || startupNotice} onSignedIn={(value) => {
      setCsrfToken(value.csrfToken);
      if (value.divisions) setDivisionScope(value.divisions);
      setSession(value);
      setNotice('');
      setStartupNotice('');
    }} />;
  }

  if (session.mustChangePassword || changingPassword) return <PasswordScreen required={!!session.mustChangePassword} onChanged={()=>{setChangingPassword(false);void signOut();}} onCancel={()=>{if(session.mustChangePassword)void signOut();else setChangingPassword(false);}}/>;

  const isActive = (path: string): boolean =>
    route.segments[0] === path || route.segments[0] + 's' === path;

  const navigation = (
    <>
      {navGroups.map((group) => (
        <div className="nav-group" key={group.key}>
          <span className="nav-group-label">{group.label}</span>
          {group.entries.map((entry) => (
            <a
              key={entry.path}
              href={`#/${entry.path}`}
              aria-current={isActive(entry.path) ? 'page' : undefined}
              className={isActive(entry.path) ? 'nav-link active' : 'nav-link'}
              onClick={() => setNavOpen(false)}
            >
              {entry.label}
            </a>
          ))}
        </div>
      ))}
    </>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{t('nav.skip')}</a>
      <header className="app-header">
        <div className="header-start">
          {!desktop ? (
            <button
              ref={menuButtonRef}
              type="button"
              className="nav-toggle"
              aria-expanded={navOpen}
              aria-controls="app-navigation"
              onClick={() => (navOpen ? closeDrawer() : setNavOpen(true))}
            >
              <span className="nav-toggle-icon" aria-hidden="true">
                ☰
              </span>
              <span className="nav-toggle-text">{t('nav.menu')}</span>
            </button>
          ) : null}
          <div className="brand">
            <img src="/branding/industrialName.png" alt="広島化成 工業用品 業務管理" className="industrial-logo" />
            <div className="brand-text"><h1>{t('app.name')}</h1>
            <p className="muted">{t('app.subtitle')}</p></div>
          </div>
        </div>
        <div className="header-actions">
          <DivisionScopeBar />
          <LanguageSwitch language={language} onChange={setLanguage} />
          <Menu
            className="account-menu"
            label={
              <>
                <span className="account-name">{session.actor.name}</span>
                <span className="role-pill">{session.actor.role}</span>
                <span className="menu-caret" aria-hidden="true">▾</span>
              </>
            }
          >
            {(close) => (
              <>
                <p className="menu-heading" aria-hidden="true">
                  {session.actor.name}
                  <span className="muted small role-line">{session.actor.role}</span>
                </p>
                {session.authMode === 'local' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      close();
                      setChangingPassword(true);
                    }}
                  >
                    {t('local.change')}
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    void signOut();
                  }}
                >
                  {t('nav.signOut')}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      {desktop ? (
        <aside className="app-sidebar" id="app-navigation">
          <nav className="app-nav" aria-label={t('app.name')}>
            {navigation}
          </nav>
        </aside>
      ) : navOpen ? (
        <>
          <div className="nav-backdrop" aria-hidden="true" onClick={closeDrawer} />
          <aside className="app-sidebar drawer-open" id="app-navigation">
            <div className="drawer-head">
              <span className="drawer-title">{t('nav.menu')}</span>
              <button type="button" className="link-button" onClick={closeDrawer} aria-label={t('nav.closeMenu')}>
                ×
              </button>
            </div>
            <nav className="app-nav" aria-label={t('app.name')}>
              {navigation}
            </nav>
          </aside>
        </>
      ) : null}

      <main className="app-main" id="main-content" tabIndex={-1}>
        {notice ? (
          <div className="banner warning app-notice" role="status">
            {notice}
          </div>
        ) : null}
        {/* Submission feedback lives in the shell, so it survives closing the dialog and moving
            to another screen. It is cleared with the session. */}
        <SubmissionNotices />
        <Suspense key={route.location} fallback={<p role="status">{t('state.loading')}</p>}>
          <div>{renderScreen(route, session.actor, isManager)}</div>
        </Suspense>
      </main>
    </div>
  );
}

/**
 * The sidebar is a layout, the drawer is navigation. The breakpoint is the same one the stylesheet
 * uses, so a narrow window never receives two navigation surfaces at once.
 */
function useDesktopNavigation(): boolean {
  const read = (): boolean =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia('(min-width: 1100px)').matches;
  const [desktop, setDesktop] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(min-width: 1100px)');
    const update = (): void => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return desktop;
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
  // The timeline is a read-only projection available to every signed-in role.
  if (first === 'timeline') {
    const from = new URLSearchParams(route.search).get('from') ?? undefined;
    return <TimelineScreen actor={actor} initialProjectId={second} initialAnchor={from} />;
  }
  // MEMBER and VIEWER browse permitted projects through the read-only explorer, never through the
  // management list (which reads `/api/manager/projects`). A MEMBER may create new work there.
  if (first === 'projects' && !isManager) return <WorkProjectsScreen actor={actor} />;
  // Read-only project detail stays reachable for MEMBER and VIEWER (the task detail links here).
  if (first === 'project' && second && !isManager) {
    return <ProjectDetailScreen actor={actor} projectId={second} readOnly />;
  }
  if (!isManager) return <OverviewScreen actor={actor} />;
  switch (first) {
    case 'accounts':
      return actor.role === 'ADMIN' ? <LocalAccountsScreen /> : <OverviewScreen actor={actor} />;
    case 'divisions':
      return actor.role === 'ADMIN' ? <DivisionsScreen /> : <OverviewScreen actor={actor} />;
    case 'deleted-items':
      return (actor.role === 'ADMIN' || actor.role === 'MANAGER') ? <DeletedItemsScreen actor={actor} /> : <OverviewScreen actor={actor} />;
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
      return <RequestsScreen actor={actor} routeSearch={route.search} />;
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
