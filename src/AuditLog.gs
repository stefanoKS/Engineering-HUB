/** Audit records retain a blank actor when Google cannot disclose identity. */
var AuditLog = (function () {
  function actor() {
    try {
      return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    } catch (error) {
      return '';
    }
  }
  function write(action, entityType, entityId, details) {
    return Database.insert('AUDIT_LOG', {
      Audit_ID: Utilities.getUuid(),
      Timestamp: new Date(),
      Actor: actor(),
      Action: action,
      Entity_Type: entityType || '',
      Entity_ID: entityId || '',
      Previous_Value: '',
      New_Value: JSON.stringify(details || {}),
      Result: 'SUCCESS'
    });
  }
  function record(entityType, entityId, action, before, after, result) {
    return Database.insert('AUDIT_LOG', {
      Audit_ID: Utilities.getUuid(), Timestamp: new Date(), Actor: actor(),
      Action: action, Entity_Type: entityType || '', Entity_ID: entityId || '',
      Previous_Value: JSON.stringify(before || {}),
      New_Value: JSON.stringify(after || {}), Result: result || 'SUCCESS'
    });
  }
  return {actor: actor, write: write, record: record};
})();
