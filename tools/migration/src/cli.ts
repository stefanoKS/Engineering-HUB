#!/usr/bin/env node
/**
 * Migration CLI.
 *
 *   npm run migration -- inventory  --snapshot export.json
 *   npm run migration -- validate   --snapshot export.json
 *   npm run migration -- import     --snapshot export.json --dry-run
 *   npm run migration -- import     --snapshot export.json
 *   npm run migration -- reconcile  --snapshot export.json --run <runId>
 *   npm run migration -- export     --out export.json          (read-only workbook read)
 *
 * The database comes from DATABASE_URL. Nothing here deploys, migrates a live workbook or sends
 * a notification.
 */
import { writeFile } from 'node:fs/promises';
import { createPool, Database, toDatabaseConfig } from '@eh/db';
import { JsonFileSource, GoogleSheetsSource } from './source';
import { inventory } from './inventory';
import { validateSnapshot, summariseIssues } from './validate';
import { importSnapshot } from './import';
import { reconcileSnapshot } from './reconcile';
import type { SourceSnapshot } from './types';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : 'true';
}

async function readSnapshot(): Promise<SourceSnapshot> {
  const file = arg('snapshot');
  if (file && file !== 'true') {
    return new JsonFileSource(file, file).read();
  }
  const spreadsheetId = process.env.MIGRATION_SPREADSHEET_ID ?? '';
  const credentials = process.env.MIGRATION_SERVICE_ACCOUNT ?? '';
  if (!spreadsheetId || !credentials) {
    throw new Error('Provide --snapshot <file> or MIGRATION_SPREADSHEET_ID + MIGRATION_SERVICE_ACCOUNT');
  }
  return new GoogleSheetsSource({ spreadsheetId, credentialsJson: credentials }).read();
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? '';
  const snapshot = await readSnapshot();

  if (command === 'export') {
    const out = arg('out');
    if (!out || out === 'true') throw new Error('--out <file> is required');
    await writeFile(out, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    process.stdout.write(`wrote ${out}\n`);
    return;
  }

  if (command === 'inventory') {
    const report = inventory(snapshot);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (command === 'validate') {
    const issues = validateSnapshot(snapshot);
    process.stdout.write(`${JSON.stringify({ summary: summariseIssues(issues), issues }, null, 2)}\n`);
    const errors = issues.filter((issue) => issue.severity === 'ERROR');
    if (errors.length) process.exitCode = 1;
    return;
  }

  const pool = createPool(toDatabaseConfig(process.env));
  const db = new Database(pool);
  try {
    if (command === 'import') {
      const result = await importSnapshot(db, snapshot, {
        dryRun: arg('dry-run') === 'true',
        allowPopulated: arg('allow-populated') === 'true',
        runId: arg('run') === 'true' ? undefined : arg('run'),
        log: (message) => process.stdout.write(`${message}\n`)
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.dryRun) process.stdout.write('dry run rolled back; no row was kept\n');
      return;
    }
    if (command === 'reconcile') {
      const runId = arg('run');
      if (!runId || runId === 'true') throw new Error('--run <runId> is required');
      const report = await reconcileSnapshot(db, snapshot, runId);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.ok) process.exitCode = 1;
      return;
    }
    throw new Error(`Unknown command: ${command || '(none)'}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
