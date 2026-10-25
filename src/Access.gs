/**
 * Server-side authorization policy and data scope.
 *
 * Identity always comes from the verified Google session (`Roles`), never from a browser
 * payload. Every management entrypoint calls into this module so a forged role, actor or
 * owner value cannot escalate privileges.
 *
 * Scope model (documented in docs/SECURITY_MODEL.md):
 * - ADMIN   : every record in the workbook.
 * - MANAGER : records of projects/subprojects they own, plus tasks they own.
 * - MEMBER  : only tasks assigned to their own verified member record.
 * - VIEWER  : read-only, no operational task list; privileged surfaces are refused.
 */
var Access = (function () {
  function identity(actorEmail) {
    var current = Roles.describe(actorEmail);
    if (!current.verified) throw new Error('A verified active account is required');
    if (!current.active) throw new Error('A verified active member account is required');
    return current;
  }

  function requireManager(actorEmail) { return Roles.requireAtLeast('MANAGER', actorEmail); }
  function requireAdmin(actorEmail) { return Roles.requireAtLeast('ADMIN', actorEmail); }
  function requireMember(actorEmail) { return Roles.requireAtLeast('MEMBER', actorEmail); }

  function selfServiceEnabled() {
    try { return Config.get().memberSelfService === true; } catch (error) { return false; }
  }

  /**
   * Sidebar access. V1.1 defaults to trusted managers only: a MEMBER can only reach the
   * workbook by being able to read every sheet, so member-level scoping is cosmetic unless the
   * deployment explicitly accepts that (ALLOW_MEMBER_SELF_SERVICE=true).
   */
  function requireUiAccess(actorEmail) {
    var current = Roles.describe(actorEmail);
    if (!current.verified) throw new Error('A verified active account is required');
    if (!current.active) throw new Error('A verified active member account is required');
    if (current.role === 'ADMIN' || current.role === 'MANAGER') return current;
    if (!selfServiceEnabled()) {
      throw new Error('Member self-service is disabled: manager access is required (ALLOW_MEMBER_SELF_SERVICE)');
    }
    if (current.role !== 'MEMBER') throw new Error('Insufficient role: MEMBER required');
    return current;
  }

  function managedProjectIds(identity) {
    var ids = Object.create(null);
    Database.read('PROJECTS').forEach(function (project) {
      if (project.Project_Owner_ID === identity.memberId) ids[project.Project_ID] = true;
    });
    Database.read('SUBPROJECTS').forEach(function (subproject) {
      if (subproject.Owner_ID === identity.memberId) ids[subproject.Project_ID] = true;
    });
    return ids;
  }

  /** Pure permission check for one task. Kept side-effect free for testability. */
  function canEditTask(identity, task, context) {
    if (!identity || !identity.active) return false;
    if (!task) return false;
    if (identity.role === 'ADMIN') return true;
    if (identity.role === 'MANAGER') {
      if (task.Owner_Member_ID && task.Owner_Member_ID === identity.memberId) return true;
      var managed = (context && context.managedProjects) || managedProjectIds(identity);
      return !!managed[task.Project_ID];
    }
    return identity.role === 'MEMBER' && !!task.Owner_Member_ID && task.Owner_Member_ID === identity.memberId;
  }

  function requireTaskWrite(taskId, actorEmail) {
    var current = identity(actorEmail);
    var task = Database.find('TASKS', taskId);
    if (!task) throw new Error('Unknown task: ' + taskId);
    if (!canEditTask(current, task)) throw new Error('This task is outside the authorized scope of the signed-in account');
    return {identity: current, task: task};
  }

  function requireProjectWrite(projectId, actorEmail) {
    var current = identity(actorEmail);
    if (current.role === 'ADMIN') return current;
    if (current.role !== 'MANAGER') throw new Error('Insufficient role: MANAGER required');
    var project = Database.find('PROJECTS', projectId);
    if (!project) throw new Error('Unknown project: ' + projectId);
    if (project.Project_Owner_ID !== current.memberId) throw new Error('This project is outside the authorized scope of the signed-in account');
    return current;
  }

  /** Task list visible to the caller; VIEWER sees no operational task rows. */
  function visibleTasks(current) {
    var tasks = Database.read('TASKS');
    if (current.role === 'ADMIN') return tasks;
    if (current.role === 'MANAGER') {
      var managed = managedProjectIds(current);
      return tasks.filter(function (task) {
        return task.Owner_Member_ID === current.memberId || !!managed[task.Project_ID];
      });
    }
    if (current.role === 'MEMBER') {
      return tasks.filter(function (task) { return task.Owner_Member_ID === current.memberId; });
    }
    return [];
  }

  function visibleProjects(current, tasks) {
    var projects = Database.read('PROJECTS');
    if (current.role === 'ADMIN' || current.role === 'MANAGER') return projects;
    var ids = Object.create(null);
    (tasks || []).forEach(function (task) { ids[task.Project_ID] = true; });
    return projects.filter(function (project) { return ids[project.Project_ID]; });
  }

  /** Directory fields only: assessments, evidence and manager chains stay manager-visible. */
  function memberDirectory(current) {
    var members = Database.read('MEMBERS');
    return members.map(function (member) {
      var base = {id: member.Member_ID, name: member.Name, active: member.Active === true};
      if (current.role === 'ADMIN' || current.role === 'MANAGER') {
        base.email = member.Email;
        base.department = member.Department;
        base.position = member.Position;
        base.role = Roles.normalize(member.Role);
        base.capacity = member.Weekly_Capacity_Hours;
      }
      if (member.Member_ID === current.memberId) {
        base.email = member.Email;
        base.role = Roles.normalize(member.Role);
        base.capacity = member.Weekly_Capacity_Hours;
      }
      return base;
    });
  }

  /** A member sees their own assessment only; managers see the full matrix. */
  function visibleSkills(current) {
    var skills = Database.read('SKILLS');
    if (current.role === 'ADMIN' || current.role === 'MANAGER') {
      return {skills: skills, assessments: Database.read('MEMBER_SKILLS'), full: true};
    }
    return {
      skills: skills,
      assessments: Database.read('MEMBER_SKILLS').filter(function (row) { return row.Member_ID === current.memberId; }),
      full: false
    };
  }

  /**
   * One-time first-administrator bootstrap.
   *
   * Requires: a current schema, an initialized workbook, no active administrator, an
   * unused bootstrap marker, a deployment-controlled allowlist entry for the verified
   * account and the exact confirmation. The workbook must also show no prior automation
   * activity, so an operational production workbook cannot be re-bootstrapped.
   */
  function bootstrapAdministrator(actorEmail, confirmation) {
    var config = Config.get();
    var email = Roles.verifiedEmail();
    var requested = String(actorEmail || '').trim().toLowerCase();
    if (!email || requested !== email) throw new Error('A verified active account is required');
    if (confirmation !== 'BOOTSTRAP ADMIN ' + email) {
      throw new Error('Explicit bootstrap confirmation required: BOOTSTRAP ADMIN ' + email);
    }
    if (!config.bootstrapAllowlist.length) throw new Error('Administrator bootstrap requires a deployment allowlist (ADMIN_BOOTSTRAP_ALLOWLIST)');
    if (config.bootstrapAllowlist.indexOf(email) < 0) throw new Error('This account is not in the deployment administrator allowlist');
    if (config.bootstrapCompletedAt) throw new Error('Administrator bootstrap has already been used for this deployment');

    return Database.withLock(function () {
      var book = Database.book();
      if (!book.getSheetByName('SCHEMA_MIGRATIONS')) throw new Error('Workbook is not initialized; bootstrap refused');
      if (Migrations.currentVersion() !== Schema.version) {
        throw new Error('Workbook schema must be current before bootstrap; run the approved migration first');
      }
      var marker = book.getSheetByName('SETTINGS');
      if (!marker || !Database.read('SETTINGS').some(function (row) { return row.Setting_ID === 'DATABASE_ENVIRONMENT'; })) {
        throw new Error('Workbook environment marker is missing; bootstrap refused');
      }
      if (config.notificationActivationAt) throw new Error('Notifications are already activated; bootstrap refused');
      if (Roles.activeAdministrators().length) throw new Error('An active administrator already exists; bootstrap is not allowed');
      if (Database.read('NOTIFICATION_LOG').length) throw new Error('Notification history exists; bootstrap refused');

      var members = Database.read('MEMBERS').filter(function (member) { return member.Active === true; });
      var candidate = members.filter(function (member) { return String(member.Email || '').toLowerCase() === email; })[0];
      if (!candidate) throw new Error('Create an active member record for this account before bootstrap');

      Database.update('MEMBERS', candidate.Member_ID, {Role: 'ADMIN'});
      PropertiesService.getScriptProperties().setProperty('ADMIN_BOOTSTRAP_COMPLETED_AT', Domain.now());
      AuditLog.write('ADMIN_BOOTSTRAPPED', 'MEMBER', candidate.Member_ID,
        {email: email, environment: config.environment, schemaVersion: Schema.version});
      return {memberId: candidate.Member_ID, email: email, environment: config.environment};
    });
  }

  return {
    identity: identity,
    requireManager: requireManager,
    requireAdmin: requireAdmin,
    requireMember: requireMember,
    requireUiAccess: requireUiAccess,
    selfServiceEnabled: selfServiceEnabled,
    managedProjectIds: managedProjectIds,
    canEditTask: canEditTask,
    requireTaskWrite: requireTaskWrite,
    requireProjectWrite: requireProjectWrite,
    visibleTasks: visibleTasks,
    visibleProjects: visibleProjects,
    memberDirectory: memberDirectory,
    visibleSkills: visibleSkills,
    bootstrapAdministrator: bootstrapAdministrator
  };
}());

function bootstrapFirstAdministrator(actorEmail, confirmation) {
  return Access.bootstrapAdministrator(actorEmail, confirmation);
}
