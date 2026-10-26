var Members = (function () {
  var ASSIGNABLE_ROLES = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'];

  function openTasks(memberId) {
    return Database.read('TASKS').filter(function (task) {
      return task.Owner_Member_ID === memberId && task.Status !== 'Done' && task.Status !== 'Cancelled';
    });
  }

  function activeAdministrators(excludeMemberId) {
    return Roles.activeAdministrators().filter(function (member) { return member.Member_ID !== excludeMemberId; });
  }

  /**
   * Privilege escalation guard.
   *
   * Only ADMIN may grant or revoke ADMIN/MANAGER. Nobody may change the role of their own
   * member record. The last active administrator can never be demoted or deactivated.
   */
  function guardRoleChange(row, before, nextRole) {
    var actor = Roles.describe();
    var previousRole = before ? Roles.normalize(before.Role) : '';
    function privileged(role) { return role === 'ADMIN' || role === 'MANAGER'; }

    if (!before) {
      if (privileged(nextRole)) Roles.requireAtLeast('ADMIN');
      return;
    }
    if (previousRole === nextRole) {
      if (previousRole === 'ADMIN' && before.Active === true && row.Active !== true &&
          !activeAdministrators(before.Member_ID).length) {
        throw new Error('The last active administrator cannot be deactivated');
      }
      return;
    }
    if (actor.verified && actor.memberId && actor.memberId === before.Member_ID) {
      throw new Error('A role cannot be changed by the account it belongs to');
    }
    if (privileged(previousRole) || privileged(nextRole)) Roles.requireAtLeast('ADMIN');
    if (previousRole === 'ADMIN' && before.Active === true && !activeAdministrators(before.Member_ID).length) {
      throw new Error('The last active administrator cannot be demoted');
    }
  }

  function validate(row, before) {
    if (row.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.Email)) Domain.fail('Invalid member email');
    var domains = Config.get().allowedDomains || [];
    if (row.Email && domains.length && domains.indexOf(row.Email.split('@')[1].toLowerCase()) === -1) Domain.fail('Member email domain is not allowed');
    if (row.Email && Database.read('MEMBERS').some(function (member) {
      return member.Member_ID !== row.Member_ID && String(member.Email).toLowerCase() === row.Email.toLowerCase();
    })) Domain.fail('Member email already exists');
    Domain.number(row.Weekly_Capacity_Hours, 'Weekly_Capacity_Hours', 0);
    if (row.Manager_ID) Domain.required('MEMBERS', row.Manager_ID);
    if (row.Manager_ID && row.Manager_ID === row.Member_ID) Domain.fail('Member cannot manage themselves');
    if (before && row.Active !== true && openTasks(row.Member_ID).length) {
      Domain.fail('Reassign open tasks before deactivating a member');
    }
    row.Role = Roles.requireValidRole(row.Role);
    guardRoleChange(row, before, Roles.normalize(row.Role));
  }

  function list(filter) {
    filter = filter || {};
    var query = String(filter.query || '').toLowerCase();
    return Database.read('MEMBERS').filter(function (member) {
      if (filter.activeOnly && member.Active !== true) return false;
      if (filter.role && Roles.normalize(member.Role) !== Roles.normalize(filter.role)) return false;
      if (query) {
        var haystack = [member.Member_ID, member.Name, member.Email, member.Department, member.Position].join(' ').toLowerCase();
        if (haystack.indexOf(query) < 0) return false;
      }
      return true;
    });
  }

  function deactivate(id) {
    var member = Domain.required('MEMBERS', id);
    var tasks = openTasks(id);
    if (tasks.length) Domain.fail('Reassign open tasks before deactivating a member (' + tasks.length + ' open)');
    if (Roles.normalize(member.Role) === 'ADMIN' && member.Active === true && !activeAdministrators(id).length) {
      Domain.fail('The last active administrator cannot be deactivated');
    }
    return Domain.save('MEMBERS', id, {Active: false}, validate, 'DEACTIVATE');
  }

  return {
    create: function (data) {
      return Domain.save('MEMBERS', null, Object.assign({ Active: true, Role: 'MEMBER' }, data), validate);
    },
    update: function (id, patch) {
      return Domain.save('MEMBERS', id, patch, validate);
    },
    deactivate: deactivate,
    openTasks: openTasks,
    list: list,
    roles: ASSIGNABLE_ROLES
  };
})();
/* Global entrypoints: member administration is manager-level; role changes stay ADMIN-only. */
function createMember(data) {
  // The very first row is the documented bootstrap step for an empty workbook (DEPLOYMENT.md):
  // no role can exist yet, so it cannot be authorized. Every later member needs a manager.
  if (Database.read('MEMBERS').length) Access.requireManager();
  return Members.create(data);
}
function updateMember(id, patch) {
  Access.requireManager();
  return Members.update(id, patch);
}
function deactivateMember(id) {
  Access.requireManager();
  return Members.deactivate(id);
}
function listMembers(filter) {
  Access.requireManager();
  return Members.list(filter);
}