// @vitest-environment jsdom
/**
 * Unmapped-work mapping panel and the new-work division defaults.
 *
 * These are rendering and payload rules: the panel must be read-only until the exact confirmation
 * phrase is typed, and it must send the record IDs, target IDs and revisions it displayed. A
 * read-only shell selection must never become a writable creation default.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UnmappedMappingView } from '@eh/contracts';
import { I18nProvider, useI18n } from '../src/i18n';
import { LanguageSwitch } from '../src/components/ui';
import { DivisionMappingPanel } from '../src/components/division-mapping-panel';
import { MemberProjectForm } from '../src/components/member-project-form';
import { clearDivisionScope, selectDivision, setDivisionScope } from '../src/state/division';
import { queryCache } from '../src/state/cache';

// jsdom does not implement the native dialog element; the Modal component needs it.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.open = false;
};

const DEV = 'DIV-DEV';
const ENG = 'DIV-ENG';

function view(overrides: Partial<UnmappedMappingView> = {}): UnmappedMappingView {
  return {
    counts: {
      responsibilities: 1,
      projects: 1,
      archivedResponsibilities: 0,
      archivedProjects: 1,
      tasks: 2,
      subprojects: 0
    },
    items: [
      {
        entityType: 'PROJECT',
        entityId: 'PRJ-U1',
        name: 'Dev legacy project',
        status: 'Active',
        archived: false,
        revision: 3,
        currentDivisionId: null,
        taskCount: 2,
        subprojectCount: 0,
        linkedProjects: [],
        state: 'SUGGESTED',
        rule: 'COMMON_MEMBERSHIP',
        proposedDivisionId: DEV,
        proposedDivisionName: '設計・開発課',
        candidates: [{ divisionId: DEV, name: '設計・開発課' }],
        assignments: [
          {
            memberId: 'MEM-A',
            name: 'Dev member',
            active: true,
            historical: false,
            workDivisionIds: [DEV],
            eligible: true,
            relations: ['TASK_OWNER']
          }
        ],
        blockers: [],
        unresolved: []
      },
      {
        entityType: 'RESPONSIBILITY',
        entityId: 'RSP-U2',
        name: '未分類B',
        status: 'Active',
        archived: false,
        revision: 2,
        currentDivisionId: null,
        taskCount: 0,
        subprojectCount: 0,
        linkedProjects: [
          { projectId: 'PRJ-U2', projectName: 'Split legacy project', divisionId: ENG, status: 'Active', archived: false }
        ],
        state: 'CONFLICT',
        rule: 'COMMON_MEMBERSHIP',
        proposedDivisionId: null,
        proposedDivisionName: null,
        candidates: [],
        assignments: [
          {
            memberId: 'MEM-PAST',
            name: 'Former owner',
            active: false,
            historical: true,
            workDivisionIds: [DEV],
            eligible: true,
            relations: ['TASK_OWNER']
          }
        ],
        blockers: ['NO_COMMON_DIVISION', 'LINKED_PROJECT_ALREADY_MAPPED:PRJ-U2'],
        unresolved: []
      }
    ],
    page: 1,
    pageSize: 10,
    total: 2,
    totalPages: 1,
    selection: { divisionId: null, responsibilityIds: [], projectIds: [] },
    divisions: [
      { divisionId: DEV, name: '設計・開発課' },
      { divisionId: ENG, name: '設計・技術課' }
    ],
    backup: {
      required: true,
      verified: false,
      backupId: null,
      createdAt: null,
      message: 'No verified backup exists.'
    },
    batchLimit: 100,
    generatedAt: '2026-11-11T00:00:00.000Z',
    ...overrides
  };
}

function Harness(): JSX.Element {
  return (
    <I18nProvider>
      <PanelWithSwitch />
    </I18nProvider>
  );
}

function PanelWithSwitch(): JSX.Element {
  const { language, setLanguage } = useI18n();
  return (
    <>
      <LanguageSwitch language={language} onChange={setLanguage} />
      <DivisionMappingPanel />
    </>
  );
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function stubPreview(payload: UnmappedMappingView, onApply?: (body: unknown) => Response) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, ...(body ? { body } : {}) });
      if (url.includes('/api/admin/divisions/mapping/apply')) {
        return (
          onApply?.(body) ??
          ok({ batchId: 'MAP-1', responsibilities: 0, projects: 1, divisions: [], backupId: 'BAK-1', replayed: false })
        );
      }
      return ok(payload);
    })
  );
  return calls;
}

beforeEach(() => {
  queryCache.clear();
});

afterEach(() => {
  cleanup();
  queryCache.clear();
  clearDivisionScope();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('mapping panel', () => {
  it('renders the Japanese mapping flow read-only and requires the exact confirmation', async () => {
    const calls = stubPreview(view());
    render(
      <I18nProvider>
        <DivisionMappingPanel />
      </I18nProvider>
    );
    expect(await screen.findByText('未分類の案件と分野の割り当て')).toBeTruthy();
    expect(screen.getByText(/未分類: 分野 1 件・案件 1 件/)).toBeTruthy();
    expect(screen.getByText(/検証済みのバックアップがありません/)).toBeTruthy();
    expect(screen.getByText('候補あり')).toBeTruthy();
    expect(screen.getByText('競合')).toBeTruthy();
    expect(screen.getByText(/すでに別の課に割り当てられた案件/)).toBeTruthy();
    expect(screen.getByText(/履歴（無効な担当者）/)).toBeTruthy();

    // No apply request on mount: the panel only reads.
    expect(calls.some((call) => call.url.includes('/mapping/apply'))).toBe(false);
    const applyButton = screen.getByRole('button', { name: '割り当てを実行' }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    // Selecting a record fills its proposed target, but the backup gate keeps apply disabled.
    fireEvent.click(screen.getByLabelText('選択: Dev legacy project'));

    expect(screen.getByText(/選択中: 1 件/)).toBeTruthy();
    const phraseInput = screen.getByLabelText(/「MAP 1 RECORD」と入力してください/) as HTMLInputElement;
    fireEvent.change(phraseInput, { target: { value: 'MAP 1 RECORD' } });
    expect((screen.getByRole('button', { name: '割り当てを実行' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches to the English labels and keeps the same pending selection', async () => {
    stubPreview(view());
    render(<Harness />);
    await screen.findByText('未分類の案件と分野の割り当て');
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByText('Unmapped work and division mapping')).toBeTruthy();
    expect(screen.getByText(/Unmapped: 1 areas, 1 projects/)).toBeTruthy();
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByText('Conflict')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply mapping' })).toBeTruthy();
  });

  it('sends the reviewed record, target and revision once the backup and phrase allow it', async () => {
    const calls = stubPreview(
      view({
        backup: {
          required: true,
          verified: true,
          backupId: 'BAK-1',
          createdAt: '2026-11-11T00:00:00.000Z',
          message: 'Verified backup BAK-1 is available for this mapping.'
        }
      })
    );
    render(
      <I18nProvider>
        <DivisionMappingPanel />
      </I18nProvider>
    );
    await screen.findByText('未分類の案件と分野の割り当て');
    expect(screen.getByText(/検証済みバックアップ: BAK-1/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('選択: Dev legacy project'));
    const phrase = screen.getByLabelText(/「MAP 1 RECORD」と入力してください/) as HTMLInputElement;
    fireEvent.change(phrase, { target: { value: 'MAP 1 RECORD' } });
    const applyButton = screen.getByRole('button', { name: '割り当てを実行' }) as HTMLButtonElement;
    await waitFor(() => expect(applyButton.disabled).toBe(false));
    fireEvent.click(applyButton);

    await waitFor(() => expect(calls.some((call) => call.url.includes('/mapping/apply'))).toBe(true));
    const applyCall = calls.find((call) => call.url.includes('/mapping/apply'));
    expect(applyCall?.body).toMatchObject({
      confirmed: true,
      confirmation: 'MAP 1 RECORD',
      batch: [{ entityType: 'PROJECT', entityId: 'PRJ-U1', divisionId: DEV, revision: 3 }]
    });
    expect(await screen.findByText(/割り当てを実行しました（分野 0 件・案件 1 件）/)).toBeTruthy();
  });

  it('shows the empty state when nothing is unmapped', async () => {
    stubPreview(
      view({
        items: [],
        total: 0,
        counts: { responsibilities: 0, projects: 0, archivedResponsibilities: 0, archivedProjects: 0, tasks: 0, subprojects: 0 }
      })
    );
    render(
      <I18nProvider>
        <DivisionMappingPanel />
      </I18nProvider>
    );
    expect(await screen.findByText('未分類の記録はありません。')).toBeTruthy();
  });

  it('never reports a failed preview as a successful empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', retryable: true, correlationId: 'c1' }
          }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        )
      )
    );
    render(
      <I18nProvider>
        <DivisionMappingPanel />
      </I18nProvider>
    );
    expect(await screen.findByText(/An unexpected error occurred|予期しない/)).toBeTruthy();
    expect(screen.queryByText('未分類の記録はありません。')).toBeNull();
  });
});

describe('new-work division defaults', () => {
  const options = {
    projectCreationEnabled: true,
    responsibilities: [
      { responsibilityId: 'RSP-DEV', name: '開発分野', divisionId: DEV },
      { responsibilityId: 'RSP-ENG', name: '技術分野', divisionId: ENG }
    ],
    divisions: [
      { divisionId: DEV, name: '設計・開発課', status: 'Active' as const, sortOrder: 1 },
      { divisionId: ENG, name: '設計・技術課', status: 'Active' as const, sortOrder: 2 }
    ]
  };

  it('uses the shell selection when it is a writable division', async () => {
    setDivisionScope({
      readable: [
        { divisionId: DEV, name: '設計・開発課', status: 'Active' },
        { divisionId: ENG, name: '設計・技術課', status: 'Active' }
      ],
      writable: [
        { divisionId: DEV, name: '設計・開発課', status: 'Active' },
        { divisionId: ENG, name: '設計・技術課', status: 'Active' }
      ],
      allDivisions: false
    });
    selectDivision(DEV);
    render(
      <I18nProvider>
        <MemberProjectForm options={options} onClose={() => undefined} onCreated={() => undefined} />
      </I18nProvider>
    );
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0]!.value).toBe(DEV);
  });

  it('never turns a shell selection the account cannot create in into a writable default', async () => {
    const PROD = 'DIV-PROD';
    setDivisionScope({
      readable: [
        { divisionId: DEV, name: '設計・開発課', status: 'Active' },
        { divisionId: ENG, name: '設計・技術課', status: 'Active' },
        { divisionId: PROD, name: '運用課', status: 'Active' }
      ],
      writable: [{ divisionId: DEV, name: '設計・開発課', status: 'Active' }],
      allDivisions: false
    });
    // The shell selection is the *read* division. It is not part of the member reference payload, so
    // neither it nor a different writable division may be assumed: the manager has to choose.
    selectDivision(PROD);
    render(
      <I18nProvider>
        <MemberProjectForm options={options} onClose={() => undefined} onCreated={() => undefined} />
      </I18nProvider>
    );
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0]!.value).toBe('');
    expect(selects[0]!.value).not.toBe(DEV);
    expect(selects[0]!.value).not.toBe(ENG);
  });

  it('keeps the shell selection when the payload offers it', async () => {
    setDivisionScope({
      readable: [
        { divisionId: DEV, name: '設計・開発課', status: 'Active' },
        { divisionId: ENG, name: '設計・技術課', status: 'Active' }
      ],
      writable: [
        { divisionId: DEV, name: '設計・開発課', status: 'Active' },
        { divisionId: ENG, name: '設計・技術課', status: 'Active' }
      ],
      allDivisions: false
    });
    selectDivision(ENG);
    render(
      <I18nProvider>
        <MemberProjectForm options={options} onClose={() => undefined} onCreated={() => undefined} />
      </I18nProvider>
    );
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0]!.value).toBe(ENG);
  });
});
