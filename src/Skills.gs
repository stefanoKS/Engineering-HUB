var Skills = (function () {
  function validate(row) {
    if (Database.read('SKILLS').some(function (skill) { return skill.Skill_ID !== row.Skill_ID && skill.Skill_Name === row.Skill_Name; })) Domain.fail('Skill name already exists');
  }

  function levelOf(memberId, skillId) {
    var matches = Database.read('MEMBER_SKILLS').filter(function (row) { return row.Member_ID === memberId && row.Skill_ID === skillId; });
    return matches.length ? matches[0] : null;
  }

  function set(memberId, skillId, level, details) {
    return Database.withLock(function () {
      Domain.required('MEMBERS', memberId);
      Domain.required('SKILLS', skillId);
      Domain.number(level, 'Current_Level', 0, 4);
      if (!Number.isInteger(level)) Domain.fail('Current_Level must be an integer from 0 to 4');
      var matches = Database.read('MEMBER_SKILLS').filter(function (row) { return row.Member_ID === memberId && row.Skill_ID === skillId; });
      if (matches.length > 1) Domain.fail('Duplicate member skill records require correction');
      var before = matches[0] || null;
      details = details || {};
      var data = {
        Member_ID: memberId, Skill_ID: skillId, Current_Level: level,
        Assessment_Date: details.assessmentDate || Domain.today(),
        Assessed_By: details.assessedBy || (before ? before.Assessed_By : ''),
        Evidence: details.evidence !== undefined ? details.evidence : (before ? before.Evidence : ''),
        Training_Action: details.trainingAction !== undefined ? details.trainingAction : (before ? before.Training_Action : ''),
        Next_Review_Date: details.nextReviewDate !== undefined ? details.nextReviewDate : (before ? before.Next_Review_Date : '')
      };
      if (data.Assessed_By && !Database.find('MEMBERS', data.Assessed_By)) Domain.fail('Assessor must be a known member');
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

  /**
   * Skill gaps for tasks with a required skill. Gaps are advisory: they never block
   * an assignment, they only recommend supervision or training.
   */
  function gaps() {
    var tasks = Database.read('TASKS');
    var skills = Object.create(null);
    Database.read('SKILLS').forEach(function (skill) { skills[skill.Skill_ID] = skill; });
    var members = Object.create(null);
    Database.read('MEMBERS').forEach(function (member) { members[member.Member_ID] = member; });
    var levels = Database.read('MEMBER_SKILLS');
    return tasks.filter(function (task) {
      return task.Required_Skill_ID && task.Status !== 'Done' && task.Status !== 'Cancelled';
    }).map(function (task) {
      var record = levels.filter(function (row) { return row.Member_ID === task.Owner_Member_ID && row.Skill_ID === task.Required_Skill_ID; })[0];
      var current = record ? Number(record.Current_Level) : 0;
      var required = Number(task.Required_Skill_Level || 0);
      var gap = Math.max(0, required - current);
      return {
        Task_ID: task.Task_ID, Task_Name: task.Task_Name, Member_ID: task.Owner_Member_ID,
        Member_Name: members[task.Owner_Member_ID] ? members[task.Owner_Member_ID].Name : '',
        Skill_ID: task.Required_Skill_ID, Skill_Name: skills[task.Required_Skill_ID] ? skills[task.Required_Skill_ID].Skill_Name : '',
        Current_Level: current, Required_Level: required, Gap: gap,
        NeedsSupervision: gap > 0,
        TrainingAction: gap > 0 ? (record && record.Training_Action) || '監督者同行または研修の検討' : ''
      };
    });
  }

  function gapMatrix() {
    var rows = [['タスクID', 'タスク', 'メンバー', 'スキル', '現レベル', '要求レベル', 'ギャップ', '推奨対応']];
    gaps().forEach(function (gap) {
      rows.push([gap.Task_ID, gap.Task_Name, gap.Member_Name, gap.Skill_Name, gap.Current_Level, gap.Required_Level, gap.Gap, gap.TrainingAction]);
    });
    return rows;
  }

  return {
    create: function (data) { return Domain.save('SKILLS', null, data, validate); },
    update: function (id, patch) { return Domain.save('SKILLS', id, patch, validate); },
    setMember: set,
    matrix: matrix,
    gaps: gaps,
    gapMatrix: gapMatrix
  };
})();
function createSkill(data) {
  Access.requireManager();
  return Skills.create(data);
}
function updateSkill(id, patch) {
  Access.requireManager();
  return Skills.update(id, patch);
}
function setMemberSkill(memberId, skillId, level, details) {
  Access.requireManager();
  return Skills.setMember(memberId, skillId, level, details);
}
function refreshSkillMatrix() {
  Access.requireManager();
  return Skills.matrix();
}
function skillGaps() {
  Access.requireManager();
  return Skills.gaps();
}