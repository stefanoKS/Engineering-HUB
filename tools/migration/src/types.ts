/** Source snapshot types shared by the inventory, validation, import and reconciliation stages. */
export type SheetTable = {
  headers: string[];
  rows: string[][];
  formulas: { row: number; column: number; formula: string }[];
};

export type SourceSnapshot = {
  label: string;
  exportedAt: string;
  spreadsheetIdMasked: string;
  tables: Record<string, SheetTable>;
  notes: string[];
};

export type ValidationIssue = {
  severity: 'ERROR' | 'WARNING';
  table: string;
  recordId: string;
  field: string;
  message: string;
};

export type InventoryReport = {
  tables: {
    name: string;
    rows: number;
    headers: string[];
    knownHeaders: string[];
    customColumns: string[];
    formulas: number;
  }[];
  unsupported: { table: string; header: string; reason: string }[];
};

export type ReconcileReport = {
  runId: string;
  tables: {
    table: string;
    sourceRows: number;
    importedRows: number;
    matchedFields: number;
    mismatchedFields: { recordId: string; field: string; source: string; stored: string }[];
  }[];
  checksum: string;
  ok: boolean;
};
