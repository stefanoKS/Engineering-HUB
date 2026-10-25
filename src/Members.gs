var Members = (function () {
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
    if (before && row.Active !== true && Database.read('TASKS').some(function (task) {
      return task.Owner_Member_ID === row.Member_ID && task.Status !== 'Done' && task.Status !== 'Cancelled';
    })) Domain.fail('Reassign open tasks before deactivating a member');
  }

  function openTasks(memberId) {
    return Database.read('TASKS').filter(function (task) {
      return task.Owner_Member_ID === memberId && task.Status !== 'Done' && task.Status !== 'Cancelled';
    });
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
    list: list
  };
})();
function createMember(data) { return Members.create(data); }
function updateMember(id, patch) { return Members.update(id, patch); }
function deactivateMember(id) { return Members.deactivate(id); }
function listMembers(filter) { return Members.list(filter); }