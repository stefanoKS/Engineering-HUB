// @vitest-environment jsdom
/**
 * Division controls in the manager client.
 *
 * These are rendering rules, not authorization: the server re-resolves the scope on every request.
 * They do prove that a single readable division is shown as a name, that a switch never offers an
 * unauthorized division, and that the oversight role receives no write capability.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { DivisionScopeBar } from '../src/components/DivisionScopeBar';
import { assigneeOptionLabel } from '../src/components/TaskAssigneePicker';
import { clearDivisionScope, selectDivision, setDivisionScope } from '../src/state/division';
import { capabilitiesOf } from '../src/state/capabilities';

const t = (key: string): string => key;

afterEach(() => {
  cleanup();
  clearDivisionScope();
});

describe('division switch', () => {
  it('shows one readable division by name instead of a selector', () => {
    setDivisionScope({
      readable: [{ divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' }],
      writable: [{ divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' }],
      allDivisions: false
    });
    render(
      <I18nProvider>
        <DivisionScopeBar />
      </I18nProvider>
    );
    expect(screen.getByText('設計・開発課')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('offers only the readable divisions plus the aggregate read scope', () => {
    setDivisionScope({
      readable: [
        { divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' },
        { divisionId: 'DIV-ENG', name: '設計・技術課', status: 'Active' }
      ],
      writable: [{ divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' }],
      allDivisions: false
    });
    render(
      <I18nProvider>
        <DivisionScopeBar />
      </I18nProvider>
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'すべての閲覧可能な課',
      '設計・開発課',
      '設計・技術課'
    ]);
    // A division outside the resolved scope is silently ignored, never offered.
    selectDivision('DIV-PROD');
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: 'DIV-ENG' } });
    expect(select.value).toBe('DIV-ENG');
  });

  it('states plainly when no division is readable', () => {
    setDivisionScope({ readable: [], writable: [], allDivisions: false });
    render(
      <I18nProvider>
        <DivisionScopeBar />
      </I18nProvider>
    );
    expect(screen.getByText('閲覧できる課がありません')).toBeTruthy();
  });
});

describe('assignee labels', () => {
  it('uses human-readable context and never the raw identifier', () => {
    expect(assigneeOptionLabel({ memberId: 'MEM-1', name: 'Same', active: true }, t)).toBe('Same');
    expect(
      assigneeOptionLabel(
        { memberId: 'MEM-1', name: 'Same', active: true, divisionNames: ['設計・開発課'] },
        t
      )
    ).toBe('Same — 設計・開発課');
    expect(
      assigneeOptionLabel(
        {
          memberId: 'MEM-1',
          name: 'Same',
          active: false,
          divisionNames: ['設計・開発課'],
          employeeId: '0012'
        },
        t
      )
    ).toBe('Same — 設計・開発課 / 0012 (assignee.inactive)');
  });
});

describe('oversight capabilities', () => {
  it('grants the oversight role no write capability', () => {
    const capabilities = capabilitiesOf({ role: 'GENERAL_MANAGER' });
    expect(capabilities.canOverseeDivisions).toBe(true);
    expect(capabilities.canEdit).toBe(false);
    expect(capabilities.canCreateTask).toBe(false);
    expect(capabilities.canCreateProject).toBe(false);
    expect(capabilities.canArchive).toBe(false);
    expect(capabilities.canDelete).toBe(false);
    expect(capabilities.canReopenTask).toBe(false);
    expect(capabilities.canSubmitCompletionRequest).toBe(false);
  });
});

describe('project creation follows the division', () => {
  const references = {
    responsibilities: [
      { id: 'RSP-DEV', name: '開発分野', status: 'Active', divisionId: 'DIV-DEV' },
      { id: 'RSP-ENG', name: '技術分野', status: 'Active', divisionId: 'DIV-ENG' }
    ],
    members: [
      { memberId: 'MEM-DEV', name: 'Dev Person', active: true, workDivisionIds: ['DIV-DEV'] },
      { memberId: 'MEM-ENG', name: 'Eng Person', active: true, workDivisionIds: ['DIV-ENG'] }
    ]
  };

  it('offers only the areas and owners of the selected division', async () => {
    setDivisionScope({
      readable: [
        { divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' },
        { divisionId: 'DIV-ENG', name: '設計・技術課', status: 'Active' }
      ],
      writable: [
        { divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' },
        { divisionId: 'DIV-ENG', name: '設計・技術課', status: 'Active' }
      ],
      allDivisions: false
    });
    const { ProjectForm } = await import('../src/screens/Projects');
    render(
      <I18nProvider>
        <ProjectForm mode="create" references={references} onClose={() => undefined} onSaved={() => undefined} />
      </I18nProvider>
    );
    const division = screen.getByLabelText(/^課/) as HTMLSelectElement;
    fireEvent.change(division, { target: { value: 'DIV-ENG' } });
    const area = screen.getByLabelText(/^分野/) as HTMLSelectElement;
    expect(Array.from(area.options).map((option) => option.value)).toEqual(['', 'RSP-ENG']);
    const owner = screen.getByLabelText(/^責任者/) as HTMLSelectElement;
    expect(Array.from(owner.options).map((option) => option.value)).toEqual(['', 'MEM-ENG']);
  });

  it('cannot submit a project without a concrete division', async () => {
    setDivisionScope({
      readable: [
        { divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' },
        { divisionId: 'DIV-ENG', name: '設計・技術課', status: 'Active' }
      ],
      writable: [
        { divisionId: 'DIV-DEV', name: '設計・開発課', status: 'Active' },
        { divisionId: 'DIV-ENG', name: '設計・技術課', status: 'Active' }
      ],
      allDivisions: false
    });
    const { ProjectForm } = await import('../src/screens/Projects');
    render(
      <I18nProvider>
        <ProjectForm mode="create" references={references} onClose={() => undefined} onSaved={() => undefined} />
      </I18nProvider>
    );
    const name = screen.getByLabelText(/^プロジェクト名/) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'New work' } });
    const area = screen.getByLabelText(/^分野/) as HTMLSelectElement;
    fireEvent.change(area, { target: { value: 'RSP-DEV' } });
    const submit = screen.getByRole('button', { name: '作成' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const division = screen.getByLabelText(/^課/) as HTMLSelectElement;
    fireEvent.change(division, { target: { value: 'DIV-DEV' } });
    expect((screen.getByRole('button', { name: '作成' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
