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

export type ReconcileTableEntry = {
  table: string;
  sourceRows: number;
  importedRows: number;
  matchedFields: number;
  /** Blank cells whose destination default is volatile and therefore unverifiable. */
  skippedFields: number;
  mismatchedFields: { recordId: string; field: string; source: string; stored: string }[];
  destinationChecksum: string;
};

export type ReconcileRelation = {
  table: string;
  expectedRows: number;
  importedRows: number;
  missing: string[];
  unexpected: string[];
};

export type ReconcileReport = {
  runId: string;
  tables: ReconcileTableEntry[];
  relations: ReconcileRelation[];
  settings: {
    table: string;
    expected: number;
    imported: number;
    mismatched: { recordId: string; field: string; source: string; stored: string }[];
  };
  /** Checksum of the source snapshot (what was exported). */
  checksum: string;
  /** Checksum of the verified destination rows (what was actually stored). */
  destinationChecksum: string;
  ok: boolean;
};
