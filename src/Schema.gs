var Schema = (function () {
  var tables = {};
  function field(name, type, options) {
    return Object.assign({ name: name, type: type || 'string', required: false,
      defaultValue: '', editable: true, values: null, ref: null }, options || {});
  }
  function table(name, id, names, types, required, refs, enums) {
    tables[name] = { name: name, id: id, fields: names.split(' ').map(function (n) {
      var f = field(n, (types || {})[n], { required: (required || []).indexOf(n) >= 0 });
      if (n === id) { f.required = true; f.editable = false; }
      if ((refs || {})[n]) f.ref = refs[n];
      if ((enums || {})[n]) f.values = enums[n];
      if (/_At$|Last_Updated|Timestamp/.test(n)) f.type = 'datetime';
      if (/_Date$|_Start$|_End$|Deadline$/.test(n)) f.type = 'date';
      if (n === 'Created_At' || n === 'Last_Updated' || n === 'Timestamp') f.defaultValue = 'NOW';
      if (n === 'Progress_Percent' || /_Hours$/.test(n)) { f.type = 'number'; f.defaultValue = 0; }
      if (n === 'Progress_Percent') { f.min = 0; f.max = 100; }
      if (/_Hours$/.test(n)) f.min = 0;
      if (/_Level$/.test(n)) { f.type = 'number'; f.min = 0; f.max = 4; f.integer = true; }
      if (n === 'Created_At' || n === 'Last_Updated' || n === 'Timestamp') f.editable = false;
      if (n === 'Progress_Percent' && name !== 'TASKS') f.editable = false;
      return f;
    }) };
  }
  var projectStates = ['Planned', 'Active', 'On Hold', 'Completed', 'Cancelled', 'Archived'];
  table('PROJECTS', 'Project_ID', 'Project_ID Project_Name Description Category Project_Owner_ID Status Priority Planned_Start Forecast_End Committed_Deadline Original_Deadline Actual_Completion Progress_Percent Health Next_Milestone Next_Action Last_Updated Created_At Archived_At Notification_Enabled',
    { Notification_Enabled: 'boolean' }, ['Project_Name', 'Status'], { Project_Owner_ID: 'MEMBERS' }, { Status: projectStates, Priority: ['Low', 'Medium', 'High', 'Critical'] });
  table('SUBPROJECTS', 'Subproject_ID', 'Subproject_ID Project_ID Subproject_Name Owner_ID Status Planned_Start Planned_End Deadline Progress_Percent Estimated_Hours Next_Action Last_Updated',
    {}, ['Project_ID', 'Subproject_Name', 'Status'], { Project_ID: 'PROJECTS', Owner_ID: 'MEMBERS' }, { Status: projectStates });
  table('TASKS', 'Task_ID', 'Task_ID Project_ID Subproject_ID Task_Name Description Owner_Member_ID Status Priority Planned_Start Due_Date Estimated_Hours Actual_Hours Progress_Percent Dependency_IDs Acceptance_Criteria Next_Action Required_Skill_ID Required_Skill_Level Assignment_Version Assignment_Approved_At Notification_Enabled Notification_Baseline Created_At Last_Updated Completed_At',
    { Assignment_Version: 'number', Notification_Enabled: 'boolean' }, ['Project_ID', 'Task_Name', 'Owner_Member_ID', 'Status'],
    { Project_ID: 'PROJECTS', Subproject_ID: 'SUBPROJECTS', Owner_Member_ID: 'MEMBERS', Required_Skill_ID: 'SKILLS' },
    { Status: ['Not Started', 'Assigned', 'In Progress', 'Blocked', 'On Hold', 'Done', 'Cancelled'], Priority: ['Low', 'Medium', 'High', 'Critical'] });
  table('MILESTONES', 'Milestone_ID', 'Milestone_ID Project_ID Subproject_ID Milestone_Name Owner_ID Target_Date Actual_Date Gate_Type Status Acceptance_Criteria Verification_Result Calendar_Event_ID Calendar_Sync_Hash',
    {}, ['Project_ID', 'Milestone_Name'], { Project_ID: 'PROJECTS', Subproject_ID: 'SUBPROJECTS', Owner_ID: 'MEMBERS' });
  table('MEMBERS', 'Member_ID', 'Member_ID Name Email Department Position Active Manager_ID Weekly_Capacity_Hours Role',
    { Active: 'boolean' }, ['Name', 'Email', 'Active'], { Manager_ID: 'MEMBERS' }, { Role: ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'] });
  table('SKILLS', 'Skill_ID', 'Skill_ID Skill_Name Category Description Required_Level', {}, ['Skill_Name']);
  table('MEMBER_SKILLS', 'Member_Skill_ID', 'Member_Skill_ID Member_ID Skill_ID Current_Level Assessment_Date Assessed_By Evidence Training_Action Next_Review_Date',
    {}, ['Member_ID', 'Skill_ID', 'Current_Level'], { Member_ID: 'MEMBERS', Skill_ID: 'SKILLS', Assessed_By: 'MEMBERS' });
  table('ISSUES', 'Issue_ID', 'Issue_ID Project_ID Subproject_ID Task_ID Description Severity Status Owner_ID Raised_Date Target_Close_Date Corrective_Action Last_Updated',
    {}, ['Project_ID', 'Description', 'Status'], { Project_ID: 'PROJECTS', Subproject_ID: 'SUBPROJECTS', Task_ID: 'TASKS', Owner_ID: 'MEMBERS' },
    { Severity: ['Low', 'Medium', 'High', 'Critical'], Status: ['Open', 'In Progress', 'Closed'] });
  table('NOTIFICATION_LOG', 'Notification_ID', 'Notification_ID Notification_Key Task_ID Recipient Notification_Type Assignment_Version Created_At Sent_At Result Error_Details Reconciled_At Reconciled_By',
    { Assignment_Version: 'number' }, ['Notification_Key', 'Result']);
  table('AUDIT_LOG', 'Audit_ID', 'Audit_ID Timestamp Entity_Type Entity_ID Action Previous_Value New_Value Actor Result');
  table('SCHEMA_MIGRATIONS', 'Migration_ID', 'Migration_ID Applied_At Previous_Version New_Version Result Backup_Reference',
    { Previous_Version: 'number', New_Version: 'number' }, ['Result']);
  table('HOLIDAYS', 'Holiday_ID', 'Holiday_ID Date Name', { Date: 'date' }, ['Date']);
  table('BACKUP_LOG', 'Backup_ID', 'Backup_ID Created_At Schema_Version Backup_Reference Result Error_Details', { Schema_Version: 'number' }, ['Result']);
  table('PHASE_TEMPLATES', 'Phase_ID', 'Phase_ID Phase_Name Duration_Days Buffer_Days Dependency_IDs',
    { Duration_Days: 'number', Buffer_Days: 'number' }, ['Phase_Name']);
  table('SETTINGS', 'Setting_ID', 'Setting_ID Name Description', {}, ['Name']);
  table('AUTOMATION_SETTINGS', 'Setting_ID', 'Setting_ID Value Description Updated_At Updated_By', {}, ['Setting_ID'], {}, {});
  table('PROJECT_PHASES', 'Project_Phase_ID', 'Project_Phase_ID Project_ID Phase_ID Phase_Name Phase_Order Duration_Days Buffer_Days Dependency_IDs Planned_Start Planned_End Status Committed_Deadline Plan_Version Active Created_At',
    { Phase_Order: 'number', Plan_Version: 'number', Active: 'boolean' }, ['Project_ID', 'Phase_Name', 'Status'],
    { Project_ID: 'PROJECTS' }, { Status: ['DRAFT', 'PLANNED'] });
  table('SCHEDULE_CONFIRMATIONS', 'Schedule_Confirmation_ID', 'Schedule_Confirmation_ID Task_ID Active Version Planned_Start Due_Date Estimated_Hours Confirmed_At Confirmed_By Notes',
    { Active: 'boolean', Version: 'number' }, ['Task_ID', 'Confirmed_At'], { Task_ID: 'TASKS' });
  ['TASKS', 'MEMBERS'].forEach(function (name) {
    tables[name].fields.forEach(function (f) {
      if (f.name === 'Notification_Enabled') f.defaultValue = false;
      if (f.name === 'Active') f.defaultValue = true;
      if (f.name === 'Assignment_Version') { f.defaultValue = 1; f.min = 1; f.integer = true; }
    });
  });
  function set(name, fieldName, options) {
    tables[name].fields.forEach(function (f) { if (f.name === fieldName) Object.assign(f, options); });
  }
  // Unknown effort stays unknown: blank, never an invented zero.
  set('TASKS', 'Estimated_Hours', { defaultValue: '', min: 0 });
  set('SUBPROJECTS', 'Estimated_Hours', { defaultValue: '', min: 0 });
  set('PROJECTS', 'Notification_Enabled', { defaultValue: true });
  set('MEMBERS', 'Role', { defaultValue: 'MEMBER' });
  set('PROJECT_PHASES', 'Phase_Order', { defaultValue: 0, min: 0, integer: true });
  set('PROJECT_PHASES', 'Plan_Version', { defaultValue: 1, min: 1, integer: true });
  set('PROJECT_PHASES', 'Duration_Days', { type: 'number', defaultValue: '', min: 0 });
  set('PROJECT_PHASES', 'Buffer_Days', { type: 'number', defaultValue: 0, min: 0 });
  set('PROJECT_PHASES', 'Active', { defaultValue: true });
  set('SCHEDULE_CONFIRMATIONS', 'Active', { defaultValue: true });
  set('SCHEDULE_CONFIRMATIONS', 'Version', { defaultValue: 1, min: 1, integer: true });
  set('SCHEDULE_CONFIRMATIONS', 'Estimated_Hours', { defaultValue: '', min: 0 });
  return { version: 3, tables: tables,
    generated: ['DASHBOARD', 'PROJECT_OVERVIEW', 'TEAM_VIEW', 'GANTT_OVERVIEW', 'TIMELINE_DATA',
      'WORKLOAD', 'SKILL_MATRIX', 'BACKPLAN', 'AUTOMATION_STATUS'],
    field: field };
}());
