/**
 * External transports.
 *
 * Each integration is an interface with a Google REST implementation and an in-memory test
 * double. Nothing here runs during automated tests, and a worker without credentials reports a
 * configuration failure instead of pretending a message was delivered.
 */
import { createHash } from 'node:crypto';
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

export type CalendarEventInput = {
  eventId: string | null;
  identityKey: string;
  summary: string;
  description: string;
  startDate: string;
  /** Inclusive business end date; the transport converts it to Calendar's exclusive date. */
  endDate: string;
};
export interface CalendarTransport {
  configured: boolean;
  upsertEvent(input: CalendarEventInput): Promise<{ eventId: string }>;
}

export interface DriveTransport {
  configured: boolean;
  /** Confirms that the destination exists and is a folder this identity may write to. */
  verifyFolder?: (folderId: string) => Promise<{ folderId: string; name: string }>;
  findBackup?: (folderId: string, backupId: string) => Promise<{fileId:string;webViewLink:string}|null>;
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

  async upsertEvent(input: CalendarEventInput): Promise<{ eventId: string }> {
    if (!this.auth || !this.calendarId) throw new Error('CALENDAR_NOT_CONFIGURED');
    const accessToken = await this.auth.token(['https://www.googleapis.com/auth/calendar.events']);
    const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
    const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(this.calendarId) + '/events';
    const id = input.eventId ?? 'eh' + createHash('sha256').update(this.calendarId + ':' + input.identityKey).digest('hex');
    const url = base + '/' + encodeURIComponent(id);
    const end = new Date(input.endDate + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    const body = { summary: input.summary, description: input.description,
      start: { date: input.startDate }, end: { date: end.toISOString().slice(0, 10) },
      extendedProperties: { private: { engineeringHubIdentity: input.identityKey } } };
    const get = () => fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    let existing = await get();
    if (existing.status === 404 && !input.eventId) {
      const created = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ ...body, id }), signal: AbortSignal.timeout(15000) });
      if (created.ok) return { eventId: id };
      if (created.status !== 409) throw new Error('Calendar create ' + created.status);
      // The previous insertion may have succeeded before its response was lost.
      existing = await get();
    }
    if (!existing.ok) throw new Error('CALENDAR_LINK_UNAVAILABLE:' + existing.status);
    const current = await existing.json() as { etag?: string; status?: string; extendedProperties?: { private?: Record<string, string> } };
    if (current.extendedProperties?.private?.engineeringHubIdentity !== input.identityKey || current.status === 'cancelled') {
      throw new Error('CALENDAR_OWNERSHIP_REFUSED');
    }
    if (!current.etag) throw new Error('CALENDAR_ETAG_MISSING');
    const patched = await fetch(url, { method: 'PATCH', headers: { ...headers, 'If-Match': current.etag }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (!patched.ok) throw new Error('Calendar update ' + patched.status);
    return { eventId: id };
  }

}

/** A Drive error that carries the operator-facing reason, not only a status number. */
export class DriveError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function driveError(status: number, detail: string): DriveError {
  if (status === 401) return new DriveError(`Drive rejected the service-account credentials (401). ${detail}`, false);
  if (status === 403) {
    return new DriveError(
      `Drive permission denied (403). Share the backup folder with the service account as Editor. ${detail}`,
      false
    );
  }
  if (status === 404) return new DriveError(`Drive backup destination not found (404). ${detail}`, false);
  if (status === 429 || status >= 500) return new DriveError(`Drive is temporarily unavailable (${status}). ${detail}`, true);
  return new DriveError(`Drive request failed (${status}). ${detail}`, false);
}

/** Reads the inclusive byte range the session reports as stored. */
function receivedBytes(range: string | null, fallback: number): number {
  const match = /bytes=\d+-(\d+)/.exec(range ?? '');
  if (!match) return fallback;
  return Number(match[1]) + 1;
}

export class GoogleDriveTransport implements DriveTransport {
  configured: boolean;
  private readonly auth: GoogleAuth | null;

  private readonly delegatedUser: string | undefined;
  /** Folder verification is one call per worker process, not one call per backup. */
  private readonly verifiedFolders = new Map<string, { folderId: string; name: string }>();
  private readonly chunkBytes: number;
  private readonly attempts: number;

  constructor(input: { credentialsJson?: string; delegatedUser?: string; chunkBytes?: number; attempts?: number }) {
    this.delegatedUser = input.delegatedUser;
    this.auth = input.credentialsJson ? new GoogleAuth(input.credentialsJson) : null;
    this.configured = !!this.auth;
    this.chunkBytes = Math.max(256 * 1024, input.chunkBytes ?? 8 * 1024 * 1024);
    this.attempts = Math.max(1, input.attempts ?? 4);
  }

  private async token(): Promise<string> {
    if (!this.auth) throw new Error('DRIVE_NOT_CONFIGURED');
    return this.auth.token(['https://www.googleapis.com/auth/drive.file'], this.delegatedUser);
  }

  async findBackup(folderId: string, backupId: string): Promise<{ fileId: string; webViewLink: string } | null> {
    if (!/^[A-Za-z0-9_-]+$/.test(folderId) || !/^BAK-[a-f0-9]+$/.test(backupId)) {
      throw new Error('Invalid backup destination or identity');
    }
    const token = await this.token();
    const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false and appProperties has { key='backupId' and value='" + backupId + "' }");
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true',
      { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) }
    );
    if (!response.ok) throw driveError(response.status, (await response.text()).slice(0, 300));
    const result = (await response.json()) as { files?: { id: string; webViewLink?: string }[] };
    const file = result.files?.[0];
    return file ? { fileId: file.id, webViewLink: file.webViewLink ?? '' } : null;
  }

  /** Fails early with a readable reason when the folder is missing, foreign or not a folder. */
  async verifyFolder(folderId: string): Promise<{ folderId: string; name: string }> {
    if (!/^[A-Za-z0-9_-]+$/.test(folderId)) throw new DriveError('The Drive backup folder ID is malformed', false);
    const cached = this.verifiedFolders.get(folderId);
    if (cached) return cached;
    const token = await this.token();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) }
    );
    if (!response.ok) throw driveError(response.status, (await response.text()).slice(0, 300));
    const body = (await response.json()) as { id?: string; name?: string; mimeType?: string };
    if (body.mimeType !== 'application/vnd.google-apps.folder') {
      throw new DriveError('The Drive backup destination is not a folder', false);
    }
    const verified = { folderId: body.id ?? folderId, name: body.name ?? '' };
    this.verifiedFolders.set(folderId, verified);
    return verified;
  }

  /**
   * Resumable upload.
   *
   * A large encrypted backup is sent in bounded chunks. A failed chunk is retried, and a retry
   * first asks the session how many bytes it already holds, so an interrupted transfer continues
   * instead of starting over. The caller records the resulting file ID, so a later attempt never
   * uploads the same artifact twice.
   */
  async upload(input: {
    name: string;
    content: Buffer;
    mimeType: string;
    folderId: string;
    appProperties?: Record<string, string>;
  }): Promise<{ fileId: string; webViewLink: string }> {
    const session = await this.startSession(input);
    let offset = 0;
    while (offset < input.content.length) {
      const end = Math.min(offset + this.chunkBytes, input.content.length);
      const chunk = input.content.subarray(offset, end);
      const result = await this.sendChunk(session, chunk, offset, input.content.length);
      if (result.file) return result.file;
      offset = result.received;
    }
    throw new DriveError('The Drive upload ended without a stored file', true);
  }

  private async startSession(input: {
    name: string;
    mimeType: string;
    folderId: string;
    content: Buffer;
    appProperties?: Record<string, string>;
  }): Promise<string> {
    const accessToken = await this.token();
    const metadata = { name: input.name, parents: [input.folderId], appProperties: input.appProperties ?? {} };
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink',
      {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': input.mimeType,
          'X-Upload-Content-Length': String(input.content.length)
        },
        body: JSON.stringify(metadata)
      }
    );
    if (!response.ok) throw driveError(response.status, (await response.text()).slice(0, 300));
    const location = response.headers.get('location') ?? '';
    if (!location.startsWith('https://')) throw new DriveError('Drive did not return a resumable session', true);
    return location;
  }

  /** Sends one chunk, retrying with a session status query instead of restarting the upload. */
  private async sendChunk(
    session: string,
    chunk: Buffer,
    offset: number,
    total: number
  ): Promise<{ file: { fileId: string; webViewLink: string } | null; received: number }> {
    let attempt = 0;
    let position = offset;
    for (;;) {
      attempt += 1;
      if (position >= offset + chunk.length) return { file: null, received: position };
      // A resumed attempt sends only the bytes the session does not hold yet.
      const body = chunk.subarray(position - offset);
      try {
        const response = await fetch(session, {
          method: 'PUT',
          signal: AbortSignal.timeout(300000),
          headers: {
            'Content-Length': String(body.length),
            'Content-Range': `bytes ${position}-${position + body.length - 1}/${total}`
          },
          body
        });
        if (response.status === 200 || response.status === 201) {
          const body = (await response.json()) as { id?: string; webViewLink?: string };
          if (!body.id) throw new DriveError('Drive returned no file identity', true);
          return { file: { fileId: body.id, webViewLink: body.webViewLink ?? '' }, received: total };
        }
        if (response.status === 308) {
          const received = receivedBytes(response.headers.get('range'), position + chunk.length);
          if (received === total) {
            // The last chunk already landed but the final answer was lost; the file exists.
            const status = await this.sessionStatus(session, total);
            if (status.file) return { file: status.file, received: total };
          }
          if (received > position) return { file: null, received };
          if (attempt >= this.attempts) throw new DriveError('Drive did not accept the backup chunk', true);
          continue;
        }
        throw driveError(response.status, (await response.text()).slice(0, 300));
      } catch (error) {
        if (error instanceof DriveError && !error.retryable) throw error;
        if (attempt >= this.attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(500 * attempt, 4000)));
        const status = await this.sessionStatus(session, total, true);
        if (status.file) return { file: status.file, received: total };
        position = Math.max(position, status.received);
      }
    }
  }

  /** Asks the session how far it got; the final status of a complete upload carries the file. */
  private async sessionStatus(
    session: string,
    total: number,
    tolerateError = false
  ): Promise<{ file: { fileId: string; webViewLink: string } | null; received: number }> {
    try {
      const response = await fetch(session, {
        method: 'PUT',
        signal: AbortSignal.timeout(60000),
        headers: { 'Content-Length': '0', 'Content-Range': `bytes */${total}` }
      });
      if (response.status === 200 || response.status === 201) {
        const body = (await response.json()) as { id?: string; webViewLink?: string };
        if (body.id) return { file: { fileId: body.id, webViewLink: body.webViewLink ?? '' }, received: total };
        return { file: null, received: 0 };
      }
      return { file: null, received: receivedBytes(response.headers.get('range'), 0) };
    } catch (error) {
      if (tolerateError) return { file: null, received: 0 };
      throw error;
    }
  }
  async listOld(folderId: string, olderThanDays: number): Promise<{ fileId: string; name: string }[]> {
    const accessToken = await this.token();
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const query = encodeURIComponent(`'${folderId}' in parents and createdTime < '${cutoff}' and trashed = false`);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) throw new Error(`Drive list ${response.status}`);
    const body = (await response.json()) as { files?: { id: string; name: string }[] };
    return (body.files ?? []).map((file) => ({ fileId: file.id, name: file.name }));
  }

  async remove(fileId: string): Promise<void> {
    const accessToken = await this.token();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
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
