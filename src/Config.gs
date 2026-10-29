/** Application release version. Kept separate from the schema, publisher and snapshot contract versions. */
var APP_VERSION = '1.7.4';

var Config = (function () {
  function get() {
    var p = PropertiesService.getScriptProperties().getProperties();
    if (['DEVELOPMENT', 'PRODUCTION'].indexOf(p.ENVIRONMENT) < 0 ||
        p.BOUND_ENVIRONMENT !== p.ENVIRONMENT || !p.SPREADSHEET_ID) {
      throw new Error('Explicit spreadsheet and matching environment binding required');
    }
    var limit = Number(p.MAX_EMAILS_PER_RUN || 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid email batch limit');
    function list(value) {
      return String(value || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    }
    return {
      environment: p.ENVIRONMENT, spreadsheetId: p.SPREADSHEET_ID,
      emailEnabled: p.EMAIL_ENABLED === 'true', dryRun: p.DRY_RUN !== 'false',
      allowedDomains: list(p.ALLOWED_RECIPIENT_DOMAINS),
      maxEmailsPerRun: limit, calendarEnabled: p.CALENDAR_ENABLED === 'true',
      calendarId: p.CALENDAR_ID || '', backupFolderId: p.BACKUP_FOLDER_ID || '',
      notificationActivationAt: p.NOTIFICATION_ACTIVATION_AT || '',
      notificationAuthorizedBy: p.NOTIFICATION_AUTHORIZED_BY || '',
      managementRecipients: (p.MANAGEMENT_RECIPIENTS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      // Deployment-controlled authorization for the one-time first-administrator bootstrap.
      bootstrapAllowlist: list(p.ADMIN_BOOTSTRAP_ALLOWLIST),
      // Explicit, documented compatibility path for pre-V1.1 workbooks that only use legacy flags.
      allowLegacyEmail: p.ALLOW_LEGACY_EMAIL_CONFIG === 'true',
      // V1.1 defaults to trusted-manager-only UI access; see docs/SECURITY_MODEL.md.
      memberSelfService: p.ALLOW_MEMBER_SELF_SERVICE === 'true',
      bootstrapCompletedAt: p.ADMIN_BOOTSTRAP_COMPLETED_AT || ''
    };
  }
  function require(key) {
    var value = PropertiesService.getScriptProperties().getProperty(key);
    if (!value) throw new Error('Missing configuration: ' + key);
    return value;
  }
  return { get: get, require: require };
}());
