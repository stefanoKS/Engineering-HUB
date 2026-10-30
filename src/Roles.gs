/**
 * Server-side application roles.
 *
 * Identity comes from the verified Google session, never from client-supplied text.
 * A member without an explicit role keeps the least privilege (VIEWER); pre-V1.1 rows
 * are not silently promoted. Google Sheets editors can still change the workbook and a
 * bound script's source, so this is an application control, not a security boundary.
 */
var Roles = (function () {
  var ORDER = {VIEWER: 0, MEMBER: 1, MANAGER: 2, ADMIN: 3};
  var NAMES = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];
  /**
   * Stable marker for a refused authorization (V1.7.7).
   *
   * The browser classifies an answer by this code instead of guessing from wording, so a timeout,
   * a validation error or an ambiguous write is never mistaken for a lost permission.
   */
  var DENIED = 'AUTHORIZATION_DENIED';
  // A message a guard (or an older layer) re-wrapped loses the property, so the wording the
  // application itself raises stays a fallback.
  var DENIAL_PATTERN = /MANAGER_ACCESS_DENIED|Insufficient role:|A verified (active )?(member )?account is required|権限がありません/;

  function denied(message) {
    var error = new Error(message);
    error.code = DENIED;
    return error;
  }

  /** True for an authorization refusal, whether it kept its code or was re-wrapped. */
  function isDenied(value) {
    var error = value instanceof Error ? value : null;
    if (error && error.code === DENIED) return true;
    return DENIAL_PATTERN.test(String(error && error.message || value || ''));
  }

  function normalize(value) {
    var role = String(value || '').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(ORDER, role) ? role : 'VIEWER';
  }

  function emailOf(value) { return String(value || '').trim().toLowerCase(); }

  function verifiedEmail() { return emailOf(AuditLog.actor()); }

  function memberByEmail(address) {
    var target = emailOf(address);
    if (!target) return null;
    return Database.read('MEMBERS').filter(function (member) {
      return emailOf(member.Email) === target;
    })[0] || null;
  }

  function describe(actorEmail) {
    var email = verifiedEmail();
    if (!email) return {verified: false, email: '', role: '', active: false};
    if (actorEmail && emailOf(actorEmail) !== email) return {verified: false, email: email, role: '', active: false};
    var member = memberByEmail(email);
    return {
      verified: true,
      email: email,
      memberId: member ? member.Member_ID : '',
      role: member ? normalize(member.Role) : '',
      active: !!member && member.Active === true
    };
  }

  function requireAtLeast(minimum, actorEmail) {
    var level = ORDER[String(minimum || '').toUpperCase()];
    if (level === undefined) throw new Error('Unknown role requirement: ' + minimum);
    var identity = describe(actorEmail);
    if (!identity.verified) throw denied('A verified active account is required');
    if (!identity.active) throw denied('A verified active member account is required');
    if (ORDER[identity.role] < level) throw denied('Insufficient role: ' + String(minimum).toUpperCase() + ' required');
    return identity;
  }

  function can(minimum, actorEmail) {
    try { requireAtLeast(minimum, actorEmail); return true; } catch (error) { return false; }
  }

  function isAdmin(identity) { return !!identity && identity.active === true && identity.role === 'ADMIN'; }

  function isManager(identity) {
    return !!identity && identity.active === true && (identity.role === 'ADMIN' || identity.role === 'MANAGER');
  }

  function activeAdministrators() {
    return Database.read('MEMBERS').filter(function (member) {
      return member.Active === true && normalize(member.Role) === 'ADMIN';
    });
  }

  /** Validates and normalizes a stored role value without silently downgrading unknown text. */
  function requireValidRole(value) {
    if (value === '' || value === null || value === undefined) return '';
    var role = String(value).trim().toUpperCase();
    if (NAMES.indexOf(role) < 0) throw new Error('Role must be one of ' + NAMES.join(', '));
    return role;
  }

  return {ORDER: ORDER, NAMES: NAMES, DENIED: DENIED, denied: denied, isDenied: isDenied,
    normalize: normalize, describe: describe, requireAtLeast: requireAtLeast,
    can: can, verifiedEmail: verifiedEmail, isAdmin: isAdmin, isManager: isManager,
    activeAdministrators: activeAdministrators, requireValidRole: requireValidRole};
}());
