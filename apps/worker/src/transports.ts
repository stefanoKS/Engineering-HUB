/**
 * External transports.
 *
 * Each integration is an interface with a Google REST implementation and an in-memory test
 * double. Nothing here runs during automated tests, and a worker without credentials reports a
 * configuration failure instead of pretending a message was delivered.
 */
import { JWT } from 'google-auth-library';

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Stable logical identity used for the ledger and for provider dedupe headers. */
  dedupeKey: string;
};

export type SendOutcome =
  | { status: 'SENT'; providerId: string }
  | { status: 'PREVIEW' }
  | { status: 'UNCERTAIN'; error: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

export interface MailTransport {
  configured: boolean;
  send(message: MailMessage): Promise<SendOutcome>;
}

export interface CalendarTransport {
  configured: boolean;
  upsertEvent(input: {
    eventId: string | null;
    summary: string;
    description: string;
    startDate: string;
    endDate: string;
  }): Promise<{ eventId: string }>;
}

export interface DriveTransport {
  configured: boolean;
  upload(input: {
    name: string;
    content: Buffer;
    mimeType: string;
    folderId: string;
    appProperties?: Record<string, string>;
  }): Promise<{ fileId: string; webViewLink: string }>;
  listOld(folderId: string, olderThanDays: number): Promise<{ fileId: string; name: string }[]>;
  remove(fileId: string): Promise<void>;
}

class GoogleAuth {
  private readonly credentials: { client_email: string; private_key: string; project_id?: string };
  constructor(json: string) {
    const parsed = JSON.parse(json) as { client_email?: string; private_key?: string; project_id?: string };
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('The Google service account credentials are incomplete');
    }
    this.credentials = {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
      project_id: parsed.project_id
    };
  }

  async token(scopes: string[], subject?: string): Promise<string> {
    const jwt = new JWT({
      email: this.credentials.client_email,
      key: this.credentials.private_key,
      scopes,
      subject
    });
    const result = await jwt.authorize();
    if (!result.access_token) throw new Error('The service account could not obtain an access token');
    return result.access_token;
  }
}

export class GmailApiTransport implements MailTransport {
  configured: boolean;
  private readonly auth: GoogleAuth | null;
  private readonly sender: string;

  constructor(input: { credentialsJson?: string; sender?: string }) {
    this.auth = input.credentialsJson ? new GoogleAuth(input.credentialsJson) : null;
    this.sender = String(input.sender ?? '');
    this.configured = !!this.auth && !!this.sender;
  }

  async send(message: MailMessage): Promise<SendOutcome> {
    if (!this.auth || !this.sender) return { status: 'FAILED', error: 'MAIL_NOT_CONFIGURED', retryable: false };
    const accessToken = await this.auth.token(['https://www.googleapis.com/auth/gmail.send'], this.sender);
    const raw = Buffer.from(
      [
        `From: ${this.sender}`,
        `To: ${message.to}`,
        `Subject: ${encodeMimeHeader(message.subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        `X-EH-Notification-Key: ${message.dedupeKey}`,
        '',
        message.text
      ].join('\r\n')
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    let response: Response;
    try {
      response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
      });
    } catch (error) {
      // A network failure may have reached the provider: the outcome is uncertain, never retried.
      return { status: 'UNCERTAIN', error: (error as Error).message };
    }
    if (response.ok) {
      const body = (await response.json()) as { id?: string };
      return { status: 'SENT', providerId: body.id ?? '' };
    }
    const detail = await response.text();
    if (response.status >= 500 || response.status === 429) {
      return { status: 'UNCERTAIN', error: `Gmail ${response.status}: ${detail.slice(0, 300)}` };
    }
    return { status: 'FAILED', error: `Gmail ${response.status}: ${detail.slice(0, 300)}`, retryable: false };
  }
}

function encodeMimeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export class GoogleCalendarTransport implements CalendarTransport {
  configured: boolean;
  private readonly auth: GoogleAuth | null;
  private readonly calendarId: string;

  constructor(input: { credentialsJson?: string; calendarId?: string }) {
    this.auth = input.credentialsJson ? new GoogleAuth(input.credentialsJson) : null;
    this.calendarId = String(input.calendarId ?? '');
    this.configured = !!this.auth && !!this.calendarId;
  }

  async upsertEvent(input: {
    eventId: string | null;
    summary: string;
    description: string;
    startDate: string;
    endDate: string;
  }): Promise<{ eventId: string }> {
    if (!this.auth || !this.calendarId) throw new Error('CALENDAR_NOT_CONFIGURED');
    const accessToken = await this.auth.token(['https://www.googleapis.com/auth/calendar.events']);
    const body = {
      summary: input.summary,
      description: input.description,
      start: { date: input.startDate },
      end: { date: input.endDate }
    };
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    const url = input.eventId ? `${base}/${encodeURIComponent(input.eventId)}` : base;
    const response = await fetch(url, {
      method: input.eventId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Calendar ${response.status}`);
    const result = (await response.json()) as { id: string };
    return { eventId: result.id };
  }
}

export class GoogleDriveTransport implements DriveTransport {
  configured: boolean;
  private readonly auth: GoogleAuth | null;

  constructor(input: { credentialsJson?: string }) {
    this.auth = input.credentialsJson ? new GoogleAuth(input.credentialsJson) : null;
    this.configured = !!this.auth;
  }

  private async token(): Promise<string> {
    if (!this.auth) throw new Error('DRIVE_NOT_CONFIGURED');
    return this.auth.token(['https://www.googleapis.com/auth/drive.file']);
  }

  async upload(input: {
    name: string;
    content: Buffer;
    mimeType: string;
    folderId: string;
    appProperties?: Record<string, string>;
  }): Promise<{ fileId: string; webViewLink: string }> {
    const accessToken = await this.token();
    const metadata = {
      name: input.name,
      parents: [input.folderId],
      appProperties: input.appProperties ?? {}
    };
    const boundary = `eh-${Date.now()}`;
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`
      ),
      input.content,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipart
      }
    );
    if (!response.ok) throw new Error(`Drive upload ${response.status}: ${await response.text()}`);
    const result = (await response.json()) as { id: string; webViewLink?: string };
    return { fileId: result.id, webViewLink: result.webViewLink ?? '' };
  }

  async listOld(folderId: string, olderThanDays: number): Promise<{ fileId: string; name: string }[]> {
    const accessToken = await this.token();
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const query = encodeURIComponent(`'${folderId}' in parents and createdTime < '${cutoff}' and trashed = false`);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) throw new Error(`Drive list ${response.status}`);
    const body = (await response.json()) as { files?: { id: string; name: string }[] };
    return (body.files ?? []).map((file) => ({ fileId: file.id, name: file.name }));
  }

  async remove(fileId: string): Promise<void> {
    const accessToken = await this.token();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok && response.status !== 404) throw new Error(`Drive delete ${response.status}`);
  }
}

/** In-memory doubles used by tests and by a dry-run worker. */
export class RecordingMailTransport implements MailTransport {
  configured = true;
  readonly sent: MailMessage[] = [];
  constructor(private readonly outcome: SendOutcome = { status: 'SENT', providerId: 'test' }) {}
  async send(message: MailMessage): Promise<SendOutcome> {
    this.sent.push(message);
    return this.outcome;
  }
}

/** One-way, append-only reporting export to a dedicated sheet. */
export class GoogleSheetsExportTransport {
  configured: boolean;
  private readonly auth: GoogleAuth | null;
  private readonly spreadsheetId: string;

  constructor(input: { credentialsJson?: string; spreadsheetId?: string }) {
    this.auth = input.credentialsJson ? new GoogleAuth(input.credentialsJson) : null;
    this.spreadsheetId = String(input.spreadsheetId ?? '');
    this.configured = !!this.auth && !!this.spreadsheetId;
  }

  async append(sheetName: string, values: string[][]): Promise<void> {
    if (!this.auth || !this.spreadsheetId) throw new Error('SHEETS_EXPORT_NOT_CONFIGURED');
    const accessToken = await this.auth.token(['https://www.googleapis.com/auth/spreadsheets']);
    const range = `${sheetName}!A1`;
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
      }
    );
    if (!response.ok) {
      throw new Error(`Sheets export ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }
}
