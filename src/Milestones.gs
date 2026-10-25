var Milestones = (function () {
  function validate(row) {
    Domain.projectLink(row);
    Domain.dates(row);
    if (row.Owner_ID) Domain.required('MEMBERS', row.Owner_ID);
  }
  return { create: function (data) { return Domain.save('MILESTONES', null, data, validate); }, update: function (id, patch) { return Domain.save('MILESTONES', id, patch, validate); } };
})();
function createMilestone(data) { return Milestones.create(data); }
function updateMilestone(id, patch) { return Milestones.update(id, patch); }
