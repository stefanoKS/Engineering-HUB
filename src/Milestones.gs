var Milestones = (function () {
  function validate(row) {
    Domain.projectLink(row);
    Domain.dates(row);
    if (row.Owner_ID) Domain.required('MEMBERS', row.Owner_ID);
  }
  return {
    create: function (data) {
      return Domain.save('MILESTONES', null, data, validate, null, function (row) {
        Projects.touch(row.Project_ID);
      });
    },
    update: function (id, patch) {
      return Domain.save('MILESTONES', id, patch, validate, null, function (row) {
        Projects.touch(row.Project_ID);
      });
    }
  };
})();
function createMilestone(data) {
  Access.requireProjectWrite(data && data.Project_ID);
  return Milestones.create(data);
}
function updateMilestone(id, patch) {
  Access.requireManager();
  return Milestones.update(id, patch);
}