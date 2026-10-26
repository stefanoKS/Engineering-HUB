var Backup = (function () {
  function snapshot(book) {
    return book.getSheets().map(function (sheet) {
      return { name: sheet.getName(), values: sheet.getDataRange().getValues(),
        formulas: sheet.getDataRange().getFormulas() };
    });
  }
  function verifySnapshot(before, after) {
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Backup contents could not be verified');
  }
  function createVerified() {
    var config = Config.get();
    var folder = DriveApp.getFolderById(Config.require('BACKUP_FOLDER_ID'));
    if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Backup folder must not allow public/domain link sharing');
    var original = Database.book();
    SpreadsheetApp.flush();
    var before = snapshot(original);
    var version = Migrations.currentVersion();
    var name = 'HK-' + config.environment + '-v' + version + '-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
    var copy = DriveApp.getFileById(config.spreadsheetId).makeCopy(name, folder);
    if (!copy.getId() || copy.isTrashed() || copy.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Backup file verification failed');
    var backupBook = SpreadsheetApp.openById(copy.getId());
    verifySnapshot(before, snapshot(backupBook));
    verifySnapshot(before, snapshot(original));
    var reference = copy.getId();
    if (original.getSheetByName('BACKUP_LOG')) Database.insert('BACKUP_LOG', {
      Schema_Version: version, Backup_Reference: reference, Result: 'VERIFIED'
    });
    return reference;
  }
  function create() {
    try { return createVerified(); } catch (error) {
      console.error('Database backup failed: ' + error.message);
      try {
        if (Database.book().getSheetByName('BACKUP_LOG')) Database.insert('BACKUP_LOG', {
          Schema_Version: Migrations.currentVersion(), Result: 'FAILED', Error_Details: error.message
        });
      } catch (loggingError) { console.error('Backup failure logging also failed: ' + loggingError.message); }
      throw error;
    }
  }
  return { create: create, snapshot: snapshot, verifySnapshot: verifySnapshot };
}());

function createDatabaseBackup() {
  // Writing a Drive backup is a privileged operational act.
  Access.requireAdmin();
  return Database.withLock(function () { return Backup.create(); });
}
