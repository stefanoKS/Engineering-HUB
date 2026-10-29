/**
 * DEV-only read benchmark (V1.7.3).
 *
 * Run this function from the Apps Script editor of a **development** deployment to measure the
 * real Workspace latency of the manager read path. It is read-only by construction:
 *
 * - every operation goes through a manager read (`readOnly` execution), so a write is refused;
 * - nothing is imported from the request inbox and no notification, publication or trigger runs;
 * - the result contains timings and service-call counts only — no record text, e-mail address,
 *   spreadsheet ID or cell content.
 *
 * The environment must be `DEVELOPMENT`. Production refuses to run it.
 *
 *   devBenchmarkManagerWeb()          // 3 repeats per operation, cold + warm reported
 *   devBenchmarkManagerWeb(1)         // one cold run only
 *
 * Copy the returned JSON into `docs/MANAGER_WEB_APP_PERFORMANCE.md` as measured evidence and
 * keep `liveWorkspace: 'MEASURED'` only when the run really happened in the development project.
 */
function devBenchmarkManagerWeb(repeats) {
  Access.requireManager();
  var environment = String(PropertiesService.getScriptProperties().getProperty('ENVIRONMENT') || '');
  if (environment !== 'DEVELOPMENT') throw new Error('The DEV benchmark runs only with ENVIRONMENT=DEVELOPMENT');
  var runs = Math.max(1, Math.min(10, Math.floor(Number(repeats) || 3)));
  var taskId = '';
  try {
    var first = Database.withReadContext(function () { return Database.read('TASKS')[0]; });
    taskId = first ? String(first.Task_ID || '') : '';
  } catch (error) { taskId = ''; }
  var operations = [
    {operation: 'bootstrap', payload: {}},
    {operation: 'overview', payload: {areas: false}},
    {operation: 'taskIndex', payload: {}},
    {operation: 'projects', payload: {}},
    {operation: 'tasks', payload: {}},
    {operation: 'references', payload: {}}
  ];
  if (taskId) operations.push({operation: 'task', payload: {id: taskId}});
  var report = {applicationVersion: APP_VERSION, schemaVersion: Schema.version,
    environment: environment, liveWorkspace: 'MEASURED', repeats: runs, measuredAt: new Date().toISOString(),
    operations: []};
  operations.forEach(function (entry) {
    var samples = [];
    for (var index = 0; index < runs + 1; index++) {
      var started = Date.now();
      var response = entry.operation === 'task'
        ? managerWebRead('task', entry.payload)
        : managerWebRead(entry.operation, Object.assign({diagnostics: true}, entry.payload));
      var elapsed = Date.now() - started;
      // The first run is the cold one; later runs are warm. A failed read is recorded, never hidden.
      if (index === 0) report.operations.push({operation: entry.operation, coldMs: elapsed, warmMs: [], reads: null});
      else samples.push(elapsed);
      if (response && response.ok === true && response.metrics && index > 0) {
        var target = report.operations[report.operations.length - 1];
        target.tableReads = response.metrics.tableReads;
        target.rangeReads = response.metrics.rangeReads;
        target.workbookOpens = response.metrics.workbookOpens;
        target.dataMs = response.metrics.dataMs;
        target.serializationMs = response.metrics.serializationMs;
        target.payloadBytes = response.metrics.payloadBytes;
        target.readBackend = response.metrics.readBackend;
      } else if (response && response.ok !== true) {
        report.operations[report.operations.length - 1].error = String(response.error || 'read failed');
      }
    }
    var sorted = samples.slice().sort(function (a, b) { return a - b; });
    var target = report.operations[report.operations.length - 1];
    target.warmMs = samples;
    target.p50Ms = sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : null;
    target.p95Ms = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
  });
  console.info(JSON.stringify(report));
  return report;
}
