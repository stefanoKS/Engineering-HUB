/**
 * The employee request inbox.
 *
 * In V2 an employee submission writes straight into PostgreSQL, so the inbox is normally
 * unconfigured. During a transition a legacy dashboard can still append rows to a Google Sheet;
 * this adapter reads them read-only and the import is idempotent on the inbox request ID.
 */
import { JWT } from 'google-auth-library';

export type InboxRequest = {
  inboxRequestId: string;
  taskId: string;
  requestType: 'DEADLINE_CHANGE' | 'COMPLETION_REPORT';
  requesterName: string;
  submittedAt: string;
  requestedDueDate: string | null;
  reason: string;
  explanation: string;
  completionNote: string;
  snapshotVersion: string;
};

export interface InboxSource {
  configured: boolean;
  list(): Promise<InboxRequest[]>;
}

export class NullInboxSource implements InboxSource {
  configured = false;
  async list(): Promise<InboxRequest[]> {
    return [];
  }
}

const HEADER_ALIASES: Record<keyof InboxRequest, string[]> = {
  inboxRequestId: ['Request_ID', 'Inbox_Request_ID', 'requestId'],
  taskId: ['Task_ID', 'taskId'],
  requestType: ['Request_Type', 'requestType'],
  requesterName: ['Requester_Name', 'requesterName'],
  submittedAt: ['Submitted_At', 'SubmittedAt'],
  requestedDueDate: ['Requested_Due_Date', 'requestedDueDate'],
  reason: ['Reason', 'reason'],
  explanation: ['Explanation', 'explanation'],
  completionNote: ['Completion_Note', 'completionNote'],
  snapshotVersion: ['Snapshot_Version', 'snapshotVersion']
};

function normalizeDate(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export class GoogleSheetsInboxSource implements InboxSource {
  configured = true;
  private readonly spreadsheetId: string;
  private readonly range: string;
  private readonly credentials: { client_email: string; private_key: string };

  constructor(input: { spreadsheetId: string; range: string; credentialsJson: string }) {
    this.spreadsheetId = input.spreadsheetId;
    this.range = input.range;
    const parsed = JSON.parse(input.credentialsJson) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('The inbox service account credentials are incomplete');
    }
    this.credentials = { client_email: parsed.client_email, private_key: parsed.private_key };
  }

  private async token(): Promise<string> {
    const jwt = new JWT({
      email: this.credentials.client_email,
      key: this.credentials.private_key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const result = await jwt.authorize();
    if (!result.access_token) throw new Error('The inbox service account could not obtain a token');
    return result.access_token;
  }

  async list(): Promise<InboxRequest[]> {
    const accessToken = await this.token();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(this.range)}?majorDimension=ROWS`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      throw new Error(`The request inbox could not be read (${response.status})`);
    }
    const body = (await response.json()) as { values?: string[][] };
    const values = body.values ?? [];
    if (values.length < 2) return [];
    const headers = (values[0] ?? []).map((header) => header.trim());
    const indexOf = (key: keyof InboxRequest): number => {
      for (const alias of HEADER_ALIASES[key]) {
        const index = headers.indexOf(alias);
        if (index >= 0) return index;
      }
      return -1;
    };
    const cells = (row: string[], key: keyof InboxRequest): string => {
      const index = indexOf(key);
      return index >= 0 ? String(row[index] ?? '').trim() : '';
    };
    const result: InboxRequest[] = [];
    for (const row of values.slice(1)) {
      const inboxRequestId = cells(row, 'inboxRequestId');
      const taskId = cells(row, 'taskId');
      const type = cells(row, 'requestType').toUpperCase();
      if (!inboxRequestId || !taskId) continue;
      if (type !== 'DEADLINE_CHANGE' && type !== 'COMPLETION_REPORT') continue;
      result.push({
        inboxRequestId,
        taskId,
        requestType: type,
        requesterName: cells(row, 'requesterName'),
        submittedAt: cells(row, 'submittedAt'),
        requestedDueDate: normalizeDate(cells(row, 'requestedDueDate')),
        reason: cells(row, 'reason'),
        explanation: cells(row, 'explanation'),
        completionNote: cells(row, 'completionNote'),
        snapshotVersion: cells(row, 'snapshotVersion')
      });
    }
    return result;
  }
}

export function createInboxSource(env: NodeJS.ProcessEnv): InboxSource {
  const spreadsheetId = String(env.REQUEST_INBOX_SPREADSHEET_ID ?? '').trim();
  const range = String(env.REQUEST_INBOX_RANGE ?? 'REQUESTS!A1:J').trim();
  const credentialsJson = String(env.REQUEST_INBOX_SERVICE_ACCOUNT ?? '').trim();
  if (!spreadsheetId || !credentialsJson) return new NullInboxSource();
  return new GoogleSheetsInboxSource({ spreadsheetId, range, credentialsJson });
}
