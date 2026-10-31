/**
 * Read-only source adapters.
 *
 * The inventory and export stages never write to the spreadsheet. A snapshot can come from a
 * JSON export (offline, reproducible, the default for tests and dry runs) or from the workbook
 * itself through a read-only service-account scope.
 */
import { readFile } from 'node:fs/promises';
import { JWT } from 'google-auth-library';
import type { SheetTable, SourceSnapshot } from './types';

export interface SourceAdapter {
  label: string;
  read(): Promise<SourceSnapshot>;
}

export class JsonFileSource implements SourceAdapter {
  constructor(
    readonly label: string,
    private readonly path: string
  ) {}

  async read(): Promise<SourceSnapshot> {
    const raw = await readFile(this.path, 'utf8');
    return JSON.parse(raw) as SourceSnapshot;
  }
}

export class GoogleSheetsSource implements SourceAdapter {
  readonly label = 'google-sheets';
  private readonly auth: JWT;
  private readonly spreadsheetId: string;

  constructor(input: { spreadsheetId: string; credentialsJson: string }) {
    const parsed = JSON.parse(input.credentialsJson) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('The migration service account credentials are incomplete');
    }
    this.spreadsheetId = input.spreadsheetId;
    this.auth = new JWT({
      email: parsed.client_email,
      key: parsed.private_key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
  }

  private async token(): Promise<string> {
    const result = await this.auth.authorize();
    if (!result.access_token) throw new Error('The migration service account could not obtain a token');
    return result.access_token;
  }

  async read(): Promise<SourceSnapshot> {
    const accessToken = await this.token();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}`;
    const metaResponse = await fetch(`${base}?fields=sheets(properties(title))`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!metaResponse.ok) throw new Error(`Workbook metadata read failed (${metaResponse.status})`);
    const meta = (await metaResponse.json()) as { sheets?: { properties?: { title?: string } }[] };
    const titles = (meta.sheets ?? [])
      .map((sheet) => sheet.properties?.title ?? '')
      .filter((title) => !!title && !title.startsWith('_'));

    const formulaResponse = await fetch(
      `${base}?fields=sheets(properties(title),data(rowData(values(userEnteredValue))))&includeGridData=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const grid = formulaResponse.ok ? await formulaResponse.json() : { sheets: [] };
    const formulasBySheet = new Map<string, { row: number; column: number; formula: string }[]>();
    for (const sheet of (grid as { sheets?: { properties?: { title?: string }; data?: { rowData?: { values?: { userEnteredValue?: { formulaValue?: string } }[] }[] }[] }[] }).sheets ?? []) {
      const title = sheet.properties?.title ?? '';
      const found: { row: number; column: number; formula: string }[] = [];
      (sheet.data ?? []).forEach((block, blockIndex) => {
        void blockIndex;
        (block.rowData ?? []).forEach((row, rowIndex) => {
          (row.values ?? []).forEach((cell, columnIndex) => {
            const formula = cell?.userEnteredValue?.formulaValue;
            if (formula) found.push({ row: rowIndex, column: columnIndex, formula });
          });
        });
      });
      formulasBySheet.set(title, found);
    }

    const tables: Record<string, SheetTable> = {};
    for (const title of titles) {
      const range = encodeURIComponent(`${title}!A1:ZZZ200000`);
      const response = await fetch(`${base}/values/${range}?majorDimension=ROWS`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) throw new Error(`Sheet ${title} could not be read (${response.status})`);
      const body = (await response.json()) as { values?: string[][] };
      const values = body.values ?? [];
      const headers = (values[0] ?? []).map((header) => header.trim());
      tables[title] = {
        headers,
        rows: values.slice(1),
        formulas: formulasBySheet.get(title) ?? []
      };
    }
    return {
      label: 'google-sheets',
      exportedAt: new Date().toISOString(),
      spreadsheetIdMasked: `…${this.spreadsheetId.slice(-4)}`,
      tables,
      notes: ['Read-only export; no cell was written by the migration tool.']
    };
  }
}
