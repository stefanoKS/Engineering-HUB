/** Read-only inventory: what exists in the source, including custom columns and formulas. */
import { TABLE_SPECS, specFor, SPECIAL_TABLES } from './map';
import type { InventoryReport, SourceSnapshot } from './types';

const SPECIAL_HEADERS: Record<string, string[]> = {
  TASK_ASSIGNEES: ['Assignment_ID', 'Task_ID', 'Member_ID', 'Assigned_At', 'Assigned_By', 'Removed_At', 'Removed_By'],
  RESPONSIBILITY_MEMBERS: [
    'Assignment_ID',
    'Responsibility_ID',
    'Member_ID',
    'Assigned_At',
    'Assigned_By',
    'Removed_At',
    'Removed_By'
  ],
  AUTOMATION_SETTINGS: ['Setting_ID', 'Value', 'Description', 'Updated_At', 'Updated_By'],
  AUDIT_LOG: [
    'Audit_ID',
    'Timestamp',
    'Entity_Type',
    'Entity_ID',
    'Action',
    'Previous_Value',
    'New_Value',
    'Actor',
    'Result'
  ]
};

export function inventory(snapshot: SourceSnapshot): InventoryReport {
  const report: InventoryReport = { tables: [], unsupported: [] };
  for (const [name, table] of Object.entries(snapshot.tables)) {
    const spec = specFor(name);
    const known = new Set<string>([
      ...(spec ? [spec.idSource] : []),
      ...(spec ? spec.columns.map((column) => column.source) : []),
      ...(SPECIAL_HEADERS[name] ?? [])
    ]);
    const customColumns = table.headers.filter((header) => header && !known.has(header));
    report.tables.push({
      name,
      rows: table.rows.length,
      headers: table.headers,
      knownHeaders: [...known].filter((header) => table.headers.includes(header)),
      customColumns,
      formulas: table.formulas.length
    });
    if (!spec && !(SPECIAL_TABLES as readonly string[]).includes(name)) {
      report.unsupported.push({
        table: name,
        header: '*',
        reason: 'No V2 target is defined for this sheet; it is exported but not imported'
      });
    }
    for (const column of customColumns) {
      report.unsupported.push({
        table: name,
        header: column,
        reason: 'Custom column: preserved in the source snapshot, not imported into a typed column'
      });
    }
    if (table.formulas.length) {
      report.unsupported.push({
        table: name,
        header: '*',
        reason: `${table.formulas.length} formula cell(s) inventoried; formulas are never imported or executed`
      });
    }
  }
  for (const spec of TABLE_SPECS) {
    if (!snapshot.tables[spec.source]) {
      report.unsupported.push({
        table: spec.source,
        header: '*',
        reason: 'Expected sheet is missing from the source snapshot'
      });
    }
  }
  return report;
}
