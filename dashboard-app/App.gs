/**
 * Shared employee dashboard — web application entry point.
 *
 * This is a *separate* Apps Script project from the manager application. It has no
 * access to the private management workbook: it reads only the sanitized snapshot
 * spreadsheet named by SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID.
 *
 * V1.3 adds one narrowly scoped write capability: appending a validated request row to the
 * separate request inbox named by REQUEST_INBOX_SPREADSHEET_ID (see RequestService.gs).
 * There is still no update or delete path, no mail sending, no Calendar access and no
 * trigger installation. The functions at the bottom of the files in this project are the
 * complete client-callable server surface.
 */
var DashboardApp = (function () {
  var TITLE = '設計・開発課 管理';
  var DEFAULT_STALE_HOURS = 24;
  var MAX_QUERY_LENGTH = 80;

  function property(name) {
    var value = PropertiesService.getScriptProperties().getProperty(name);
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function config() {
    var staleHours = Number(property('SHARED_DASHBOARD_STALE_HOURS'));
    if (!isFinite(staleHours) || staleHours <= 0) staleHours = DEFAULT_STALE_HOURS;
    return {
      spreadsheetId: property('SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID'),
      allowedDomain: property('SHARED_DASHBOARD_ALLOWED_DOMAIN').toLowerCase(),
      requireEmail: property('SHARED_DASHBOARD_REQUIRE_EMAIL').toLowerCase() === 'true',
      staleHours: staleHours
    };
  }

  /**
   * Best-effort viewer identity.
   *
   * Apps Script may legitimately return an empty address for a web app that runs as its
   * deployer (Workspace privacy settings, external accounts, execution contexts). The
   * primary access control is therefore the deployment ACL (`access: DOMAIN`); this check
   * is defence in depth. Set SHARED_DASHBOARD_REQUIRE_EMAIL=true to fail closed when the
   * address cannot be resolved.
   */
  function viewer() {
    var email = '';
    try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); } catch (error) { email = ''; }
    return {email: email, resolved: !!email};
  }

  function requireViewer() {
    var settings = config();
    if (!settings.spreadsheetId) throw new Error('DASHBOARD_NOT_CONFIGURED');
    var current = viewer();
    if (!current.resolved) {
      if (settings.requireEmail) throw new Error('VIEWER_NOT_ALLOWED');
      return {resolved: false};
    }
    if (settings.allowedDomain && current.email.split('@')[1] !== settings.allowedDomain) {
      throw new Error('VIEWER_NOT_ALLOWED');
    }
    // The address stays on the server: only a boolean is returned to the browser.
    return {resolved: true};
  }

  function cleanQuery(value) {
    return String(value === null || value === undefined ? '' : value).slice(0, MAX_QUERY_LENGTH);
  }

  return {
    TITLE: TITLE,
    config: config,
    requireViewer: requireViewer,
    viewer: viewer,
    cleanQuery: cleanQuery
  };
}());

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Serves the single-page dashboard. Never throws: the page reports configuration errors. */
function doGet() {
  var output = HtmlService.createTemplateFromFile('Index').evaluate();

  output.setTitle(DashboardApp.TITLE);
  output.addMetaTag(
    'viewport',
    'width=device-width, initial-scale=1'
  );

  return output;
}

/* ------------------------------------------------------------------ *
 * Client-callable server API. Every function below is read-only and
 * returns a structured {ok, data} / {ok, error} envelope.
 * ------------------------------------------------------------------ */

function dashboardPortfolio(request) {
  return DashboardData.portfolio(request);
}

function dashboardProject(projectId, options) {
  return DashboardData.project(projectId, options);
}

function dashboardTask(projectId, taskId) {
  return DashboardData.task(projectId, taskId);
}
