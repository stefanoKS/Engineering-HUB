var Issues = (function () {
  function validate(row) {
    Domain.projectLink(row);
    Domain.dates(row);
    if (row.Owner_ID) Domain.required('MEMBERS', row.Owner_ID);
    if (row.Task_ID) {
      var task = Domain.required('TASKS', row.Task_ID);
      if (task.Project_ID !== row.Project_ID || (row.Subproject_ID && task.Subproject_ID !== row.Subproject_ID)) Domain.fail('Issue task must match project and subproject');
    }
  }
  return {
    create: function (data) {
      return Domain.save('ISSUES', null, Object.assign({ Status: 'Open', Raised_Date: Domain.today() }, data), validate, null, function (row) {
        Projects.touch(row.Project_ID);
      });
    },
    update: function (id, patch) {
      return Domain.save('ISSUES', id, Object.assign({ Last_Updated: Domain.now() }, patch), validate, null, function (row) {
        Projects.touch(row.Project_ID);
      });
    }
  };
})();
function createIssue(data) { return Issues.create(data); }
function updateIssue(id, patch) { return Issues.update(id, patch); }