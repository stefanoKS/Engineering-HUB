var Subprojects = (function () {
  function validate(row, before) {
    Domain.required('PROJECTS', row.Project_ID);
    Domain.dates(row);
    if (row.Owner_ID) Domain.required('MEMBERS', row.Owner_ID);
    if (before && before.Project_ID !== row.Project_ID) {
      ['TASKS', 'ISSUES', 'MILESTONES'].forEach(function (table) {
        if (Database.read(table).some(function (child) { return child.Subproject_ID === row.Subproject_ID; })) {
          Domain.fail('Cannot move a subproject with linked records');
        }
      });
    }
  }
  return {
    create: function (data) {
      return Domain.save('SUBPROJECTS', null, Object.assign({ Status: 'Planned', Last_Updated: Domain.now() }, data), validate, null, function (row) {
        Projects.touch(row.Project_ID);
      });
    },
    update: function (id, patch) {
      return Domain.save('SUBPROJECTS', id, Object.assign({ Last_Updated: Domain.now() }, patch), validate, null, function (row, before) {
        if (before && before.Project_ID !== row.Project_ID) Projects.touch(before.Project_ID);
        Projects.touch(row.Project_ID);
      });
    },
    archive: function (id) {
      return Domain.save('SUBPROJECTS', id, {Status: 'Archived', Last_Updated: Domain.now()}, validate, 'ARCHIVE');
    }
  };
})();
function createSubproject(data) { return Subprojects.create(data); }
function updateSubproject(id, patch) { return Subprojects.update(id, patch); }
function archiveSubproject(id) { return Subprojects.archive(id); }