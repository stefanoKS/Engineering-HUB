var Skills = (function () {
  function validate(row) {
    if (Database.read('SKILLS').some(function (skill) { return skill.Skill_ID !== row.Skill_ID && skill.Skill_Name === row.Skill_Name; })) Domain.fail('Skill name already exists');
  }
  function set(memberId, skillId, level) {
    return Database.withLock(function () {
      Domain.required('MEMBERS', memberId);
      Domain.required('SKILLS', skillId);
      Domain.number(level, 'Current_Level', 0, 4);
      if (!Number.isInteger(level)) Domain.fail('Current_Level must be an integer from 0 to 4');
      var matches = Database.read('MEMBER_SKILLS').filter(function (row) { return row.Member_ID === memberId && row.Skill_ID === skillId; });
      if (matches.length > 1) Domain.fail('Duplicate member skill records require correction');
      var before = matches[0] || null;
      var data = { Member_ID: memberId, Skill_ID: skillId, Current_Level: level, Assessment_Date: Domain.today() };
      var result = before ? Database.update('MEMBER_SKILLS', before.Member_Skill_ID, data) : Database.insert('MEMBER_SKILLS', data);
      AuditLog.record('MEMBER_SKILLS', result.Member_Skill_ID, before ? 'UPDATE' : 'CREATE', before, result, 'SUCCESS');
      return result;
    });
  }
  function matrix() {
    var members = Database.read('MEMBERS').filter(function (row) { return row.Active === true; });
    var skills = Database.read('SKILLS'), levels = Database.read('MEMBER_SKILLS');
    var rows = [['メンバーID', 'メンバー'].concat(skills.map(function (skill) { return skill.Skill_Name; }))];
    members.forEach(function (member) {
      rows.push([member.Member_ID, member.Name].concat(skills.map(function (skill) {
        var match = levels.filter(function (level) { return level.Member_ID === member.Member_ID && level.Skill_ID === skill.Skill_ID; })[0];
        return match ? match.Current_Level : '';
      })));
    });
    Database.writeGenerated('SKILL_MATRIX', rows);
    return rows;
  }
  return { create: function (data) { return Domain.save('SKILLS', null, data, validate); }, update: function (id, patch) { return Domain.save('SKILLS', id, patch, validate); }, setMember: set, matrix: matrix };
})();
function createSkill(data) { return Skills.create(data); }
function updateSkill(id, patch) { return Skills.update(id, patch); }
function setMemberSkill(memberId, skillId, level) { return Skills.setMember(memberId, skillId, level); }
function refreshSkillMatrix() { return Skills.matrix(); }
