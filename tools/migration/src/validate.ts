/**
 * Dry-run validation.
 *
 * Everything that would make an import lossy or invalid is reported before a row is written:
 * duplicate identifiers, broken references, invalid dates or enum values, hierarchy cycles,
 * over-deep branches and cross-project links.
 */
import { MAX_SUBPROJECT_DEPTH, MAX_TASK_DEPTH, normalizeDate } from '@eh/domain';
import { TABLE_SPECS, specFor, splitIds, type TableSpec } from './map';
import type { SourceSnapshot, ValidationIssue } from './types';

type Row = Record<string, string>;

function rowsOf(snapshot: SourceSnapshot, source: string): Row[] {
  const table = snapshot.tables[source];
  if (!table) return [];
  return table.rows
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .map((row) => {
      const record: Row = {};
      table.headers.forEach((header, index) => {
        if (!header) return;
        record[header] = String(row[index] ?? '');
      });
      return record;
    });
}

function idsOf(snapshot: SourceSnapshot, spec: TableSpec): Set<string> {
  return new Set(rowsOf(snapshot, spec.source).map((row) => row[spec.idSource]?.trim()).filter(Boolean) as string[]);
}

export function validateSnapshot(snapshot: SourceSnapshot): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    severity: ValidationIssue['severity'],
    table: string,
    recordId: string,
    field: string,
    message: string
  ): void => {
    issues.push({ severity, table, recordId, field, message });
  };

  const ids = new Map<string, Set<string>>();
  for (const spec of TABLE_SPECS) ids.set(spec.source, idsOf(snapshot, spec));

  for (const spec of TABLE_SPECS) {
    const seen = new Set<string>();
    for (const row of rowsOf(snapshot, spec.source)) {
      const id = row[spec.idSource]?.trim() ?? '';
      if (!id) {
        add('ERROR', spec.source, '(blank)', spec.idSource, 'A record has no identifier');
        continue;
      }
      if (seen.has(id)) add('ERROR', spec.source, id, spec.idSource, 'Duplicate identifier');
      seen.add(id);
      for (const column of spec.columns) {
        const raw = row[column.source] ?? '';
        if (raw === '') continue;
        if (column.type === 'date' && !normalizeDate(raw)) {
          add('ERROR', spec.source, id, column.source, `Invalid date: ${raw}`);
        }
        if (column.type === 'number' && !Number.isFinite(Number(String(raw).replace(/,/g, '')))) {
          add('ERROR', spec.source, id, column.source, `Invalid number: ${raw}`);
        }
        if (column.type === 'enum' && column.values && !column.values.includes(raw.trim())) {
          add('ERROR', spec.source, id, column.source, `Unsupported value: ${raw}`);
        }
      }
    }
  }

  const memberIds = ids.get('MEMBERS') ?? new Set<string>();
  const responsibilityIds = ids.get('RESPONSIBILITIES') ?? new Set<string>();
  const projectIds = ids.get('PROJECTS') ?? new Set<string>();
  const subprojectIds = ids.get('SUBPROJECTS') ?? new Set<string>();
  const taskIds = ids.get('TASKS') ?? new Set<string>();
  const skillIds = ids.get('SKILLS') ?? new Set<string>();

  const requireRef = (
    table: string,
    id: string,
    field: string,
    value: string,
    known: Set<string>
  ): void => {
    if (!value) return;
    if (!known.has(value)) add('ERROR', table, id, field, `Reference not found: ${value}`);
  };

  for (const row of rowsOf(snapshot, 'PROJECTS')) {
    requireRef('PROJECTS', row.Project_ID ?? '', 'Responsibility_ID', row.Responsibility_ID ?? '', responsibilityIds);
    requireRef('PROJECTS', row.Project_ID ?? '', 'Project_Owner_ID', row.Project_Owner_ID ?? '', memberIds);
  }

  const subprojectRows = rowsOf(snapshot, 'SUBPROJECTS');
  const subprojectParents = new Map<string, string>();
  for (const row of subprojectRows) {
    const id = row.Subproject_ID ?? '';
    requireRef('SUBPROJECTS', id, 'Project_ID', row.Project_ID ?? '', projectIds);
    requireRef('SUBPROJECTS', id, 'Owner_ID', row.Owner_ID ?? '', memberIds);
    if (row.Parent_Subproject_ID) {
      requireRef('SUBPROJECTS', id, 'Parent_Subproject_ID', row.Parent_Subproject_ID, subprojectIds);
      subprojectParents.set(id, row.Parent_Subproject_ID);
      const parent = subprojectRows.find((candidate) => candidate.Subproject_ID === row.Parent_Subproject_ID);
      if (parent && parent.Project_ID !== row.Project_ID) {
        add('ERROR', 'SUBPROJECTS', id, 'Parent_Subproject_ID', 'Parent belongs to another project');
      }
    }
  }
  for (const [id, parent] of subprojectParents) {
    const seen = new Set<string>([id]);
    let current = parent;
    let depth = 2;
    while (current) {
      if (seen.has(current)) {
        add('ERROR', 'SUBPROJECTS', id, 'Parent_Subproject_ID', 'Hierarchy cycle');
        break;
      }
      seen.add(current);
      depth += 1;
      if (depth > MAX_SUBPROJECT_DEPTH) {
        add('ERROR', 'SUBPROJECTS', id, 'Parent_Subproject_ID', `Deeper than ${MAX_SUBPROJECT_DEPTH} levels`);
        break;
      }
      current = subprojectParents.get(current) ?? '';
    }
  }

  const taskRows = rowsOf(snapshot, 'TASKS');
  const taskParents = new Map<string, string>();
  const taskProject = new Map<string, string>();
  const taskSubproject = new Map<string, string>();
  for (const row of taskRows) {
    const id = row.Task_ID ?? '';
    requireRef('TASKS', id, 'Project_ID', row.Project_ID ?? '', projectIds);
    requireRef('TASKS', id, 'Subproject_ID', row.Subproject_ID ?? '', subprojectIds);
    requireRef('TASKS', id, 'Owner_Member_ID', row.Owner_Member_ID ?? '', memberIds);
    requireRef('TASKS', id, 'Required_Skill_ID', row.Required_Skill_ID ?? '', skillIds);
    taskProject.set(id, row.Project_ID ?? '');
    taskSubproject.set(id, row.Subproject_ID ?? '');
    if (row.Parent_Task_ID) {
      requireRef('TASKS', id, 'Parent_Task_ID', row.Parent_Task_ID, taskIds);
      taskParents.set(id, row.Parent_Task_ID);
    }
    for (const dependencyId of splitIds(row.Dependency_IDs ?? '')) {
      requireRef('TASKS', id, 'Dependency_IDs', dependencyId, taskIds);
    }
  }
  for (const [id, parent] of taskParents) {
    if (taskProject.get(parent) !== taskProject.get(id)) {
      add('ERROR', 'TASKS', id, 'Parent_Task_ID', 'Parent belongs to another project');
    }
    if ((taskSubproject.get(parent) ?? '') !== (taskSubproject.get(id) ?? '')) {
      add('ERROR', 'TASKS', id, 'Parent_Task_ID', 'Parent belongs to another subproject');
    }
    const seen = new Set<string>([id]);
    let current = parent;
    let depth = 2;
    while (current) {
      if (seen.has(current)) {
        add('ERROR', 'TASKS', id, 'Parent_Task_ID', 'Hierarchy cycle');
        break;
      }
      seen.add(current);
      depth += 1;
      if (depth > MAX_TASK_DEPTH) {
        add('ERROR', 'TASKS', id, 'Parent_Task_ID', `Deeper than ${MAX_TASK_DEPTH} levels`);
        break;
      }
      current = taskParents.get(current) ?? '';
    }
  }

  const dependencyEdges = new Map<string, string[]>();
  for (const row of taskRows) {
    const id = row.Task_ID ?? '';
    dependencyEdges.set(id, splitIds(row.Dependency_IDs ?? ''));
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === 'done') return;
    if (current === 'visiting') {
      add('ERROR', 'TASKS', id, 'Dependency_IDs', 'Dependency cycle');
      return;
    }
    state.set(id, 'visiting');
    for (const next of dependencyEdges.get(id) ?? []) visit(next);
    state.set(id, 'done');
  };
  for (const id of dependencyEdges.keys()) visit(id);

  for (const row of rowsOf(snapshot, 'MEMBER_SKILLS')) {
    requireRef('MEMBER_SKILLS', row.Member_Skill_ID ?? '', 'Member_ID', row.Member_ID ?? '', memberIds);
    requireRef('MEMBER_SKILLS', row.Member_Skill_ID ?? '', 'Skill_ID', row.Skill_ID ?? '', skillIds);
  }
  for (const row of rowsOf(snapshot, 'TASK_REQUESTS')) {
    requireRef('TASK_REQUESTS', row.Request_ID ?? '', 'Task_ID', row.Task_ID ?? '', taskIds);
    if (!row.Task_Revision_At_Submission) {
      add('WARNING', 'TASK_REQUESTS', row.Request_ID ?? '', 'Task_Revision_At_Submission', 'Missing submission revision');
    }
  }
  for (const row of rowsOf(snapshot, 'TASK_DEADLINE_HISTORY')) {
    requireRef('TASK_DEADLINE_HISTORY', row.History_ID ?? '', 'Task_ID', row.Task_ID ?? '', taskIds);
  }

  return issues;
}

export function summariseIssues(issues: ValidationIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === 'ERROR').length;
  const warnings = issues.length - errors;
  return `${errors} error(s), ${warnings} warning(s)`;
}

export { specFor };
