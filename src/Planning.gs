var Planning = (function () {
  var DAY = 86400000;
  function shift(day, amount) {
    var d = new Date(Domain.date(day) + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + amount);
    return d.toISOString().slice(0, 10);
  }
  function calendar(holidays) {
    var blocked = Object.create(null);
    holidays.forEach(function (row) { blocked[Domain.date(row.Date)] = true; });
    function working(day) {
      var weekday = new Date(day + 'T00:00:00Z').getUTCDay();
      return weekday !== 0 && weekday !== 6 && !blocked[day];
    }
    function previous(day, inclusive) {
      var value = inclusive ? day : shift(day, -1);
      while (!working(value)) value = shift(value, -1);
      return value;
    }
    return { working: working, previous: previous };
  }

  function schedulePhases(deadline, phases) {
    var cal = calendar(Database.read('HOLIDAYS')), map = Object.create(null), successors = Object.create(null), order = [], visiting = Object.create(null), seen = Object.create(null);
    phases.forEach(function (phase) {
      if (!phase.Phase_ID || map[phase.Phase_ID]) Domain.fail('Phase IDs must be unique and explicit');
      Domain.number(phase.Duration_Days, 'Duration_Days', 1);
      Domain.number(phase.Buffer_Days, 'Buffer_Days', 0);
      if (phase.Duration_Days !== '' && phase.Duration_Days !== undefined && phase.Duration_Days !== null && !Number.isInteger(phase.Duration_Days)) Domain.fail('Duration_Days must be an integer');
      if (phase.Buffer_Days && !Number.isInteger(phase.Buffer_Days)) Domain.fail('Buffer_Days must be an integer');
      map[phase.Phase_ID] = phase;
      successors[phase.Phase_ID] = [];
    });
    phases.forEach(function (phase) {
      Tasks.dependencies(phase.Dependency_IDs).forEach(function (id) {
        if (!map[id]) Domain.fail('Unknown phase dependency: ' + id);
        successors[id].push(phase.Phase_ID);
      });
    });
    function visit(id) {
      if (visiting[id]) Domain.fail('Cyclic phase dependency');
      if (seen[id]) return;
      visiting[id] = true;
      successors[id].forEach(visit);
      delete visiting[id];
      seen[id] = true;
      order.push(id);
    }
    Object.keys(map).forEach(visit);
    var schedule = Object.create(null);
    order.forEach(function (id) {
      var phase = map[id], duration = phase.Duration_Days, downstream = successors[id];
      var unknown = duration === '' || duration === undefined || duration === null || downstream.some(function (next) { return schedule[next].Status === 'DRAFT'; });
      if (unknown) {
        schedule[id] = { Phase_ID: id, Phase_Name: phase.Phase_Name, Start_Date: '', End_Date: '', Status: 'DRAFT' };
        return;
      }
      var end = cal.previous(deadline, true);
      downstream.forEach(function (next) {
        var candidate = cal.previous(schedule[next].Start_Date, false);
        if (candidate < end) end = candidate;
      });
      var start = end, days = duration + Number(phase.Buffer_Days || 0);
      for (var i = 1; i < days; i++) start = cal.previous(start, false);
      schedule[id] = { Phase_ID: id, Phase_Name: phase.Phase_Name, Start_Date: start, End_Date: end, Status: 'PLANNED' };
    });
    return schedule;
  }

  function backplanRows() {
    var rows = [['プロジェクトID', '計画版', 'フェーズID', 'フェーズ', '開始日', '終了日', '状態', '確定期限']];
    var active = Database.read('PROJECT_PHASES').filter(function (row) { return row.Active === true; });
    active.sort(function (a, b) {
      if (a.Project_ID !== b.Project_ID) return a.Project_ID < b.Project_ID ? -1 : 1;
      return Number(a.Phase_Order || 0) - Number(b.Phase_Order || 0);
    });
    active.forEach(function (row) {
      rows.push([row.Project_ID, row.Plan_Version, row.Phase_ID, row.Phase_Name, row.Planned_Start, row.Planned_End, row.Status, row.Committed_Deadline]);
    });
    return rows;
  }

  function writeBackplan() { Database.writeGenerated('BACKPLAN', backplanRows()); }

  /**
   * Reverse planning. Only this project's phases are superseded; other projects keep
   * their stored plans. Dates are derived from declared durations, holidays and weekends,
   * and the committed deadline is stored separately from the generated overview.
   */
  function reverse(projectId, deadline, phases, options) {
    Domain.required('PROJECTS', projectId);
    deadline = Domain.date(deadline, 'Deadline');
    if (!deadline) Domain.fail('Deadline is required');
    phases = phases || Database.read('PHASE_TEMPLATES');
    if (!phases.length) Domain.fail('At least one planning phase is required');
    var schedule = schedulePhases(deadline, phases);
    options = options || {};
    return Database.withLock(function () {
      if (options.persist !== false && Database.book().getSheetByName('PROJECT_PHASES')) {
        var existing = Database.read('PROJECT_PHASES').filter(function (row) { return row.Project_ID === projectId; });
        var version = existing.reduce(function (value, row) { return Math.max(value, Number(row.Plan_Version) || 0); }, 0) + 1;
        var superseded = existing.filter(function (row) { return row.Active === true; }).map(function (row) {
          return {id: row.Project_Phase_ID, patch: {Active: false}};
        });
        if (superseded.length) Database.updateMany('PROJECT_PHASES', superseded);
        phases.forEach(function (phase, index) {
          var item = schedule[phase.Phase_ID];
          Database.insert('PROJECT_PHASES', {
            Project_ID: projectId, Phase_ID: phase.Phase_ID, Phase_Name: phase.Phase_Name,
            Phase_Order: index, Duration_Days: Estimates.known(phase.Duration_Days) ? phase.Duration_Days : '',
            Buffer_Days: Number(phase.Buffer_Days || 0), Dependency_IDs: phases[index].Dependency_IDs || '',
            Planned_Start: item.Start_Date || '', Planned_End: item.End_Date || '',
            Status: item.Status, Committed_Deadline: deadline, Plan_Version: version, Active: true
          });
        });
        writeBackplan();
      }
      return phases.map(function (phase) { return schedule[phase.Phase_ID]; });
    });
  }

  function maps() {
    var projects = Object.create(null), subprojects = Object.create(null);
    Database.read('PROJECTS').forEach(function (project) { projects[project.Project_ID] = project; });
    Database.read('SUBPROJECTS').forEach(function (subproject) { subprojects[subproject.Subproject_ID] = subproject; });
    return {projects: projects, subprojects: subprojects};
  }

  function workloadData(asOf) {
    asOf = Domain.date(asOf || Domain.today());
    var cal = calendar(Database.read('HOLIDAYS'));
    var weekday = new Date(asOf + 'T00:00:00Z').getUTCDay();
    var monday = shift(asOf, -((weekday + 6) % 7)), days = [];
    for (var i = 0; i < 7; i++) {
      var day = shift(monday, i);
      if (cal.working(day)) days.push(day);
    }
    var lookups = maps();
    var members = Database.read('MEMBERS').filter(function (member) { return member.Active === true; });
    var tasks = Database.read('TASKS');
    var rows = [['メンバーID', 'メンバー', '週開始日', '残作業時間', '週容量', '負荷率', '未見積タスク数', '実績時間', '期限超過タスク数', '超過警告']];
    var result = members.map(function (member) {
      var hours = 0, unknown = 0, actual = 0, overdue = 0;
      tasks.forEach(function (task) {
        if (task.Owner_Member_ID !== member.Member_ID || task.Status === 'Done' || task.Status === 'Cancelled') return;
        if (!Eligibility.taskInActiveWork(task, lookups.projects, lookups.subprojects)) return;
        actual += Estimates.known(task.Actual_Hours) ? task.Actual_Hours : 0;
        if (task.Due_Date && task.Due_Date < asOf) overdue++;
        var remaining = Estimates.remaining(task);
        if (remaining === null) { unknown++; return; }
        if (!task.Planned_Start || !task.Due_Date) { unknown++; return; }
        var start = Domain.date(task.Planned_Start), end = Domain.date(task.Due_Date);
        if (end < asOf) start = asOf;
        else if (start < asOf) start = asOf;
        if (end < start) end = start;
        var total = 0, overlap = 0;
        for (var cursor = start; cursor <= end; cursor = shift(cursor, 1)) {
          if (cal.working(cursor)) { total++; if (days.indexOf(cursor) !== -1) overlap++; }
        }
        if (total) hours += remaining * overlap / total;
      });
      hours = Math.round(hours * 100) / 100;
      var capacity = Number(member.Weekly_Capacity_Hours || 0) * days.length / 5;
      var utilization = capacity ? hours / capacity : null;
      var item = {
        Member_ID: member.Member_ID, Name: member.Name, Week_Start: monday,
        Remaining_Hours: hours, Capacity_Hours: capacity, Utilization: utilization,
        Unknown_Tasks: unknown, Actual_Hours: Math.round(actual * 100) / 100,
        Overdue_Tasks: overdue, Overallocated: utilization !== null && utilization > 1
      };
      rows.push([member.Member_ID, member.Name, monday, hours, capacity, utilization === null ? '' : utilization,
        unknown, item.Actual_Hours, overdue, item.Overallocated ? '超過' : '']);
      return item;
    });
    return {members: result, rows: rows, weekStart: monday, workingDays: days.length};
  }

  function workload(asOf) {
    var data = workloadData(asOf);
    Database.writeGenerated('WORKLOAD', data.rows);
    return data.members;
  }

  return { reverse: reverse, workload: workload, workloadData: workloadData, calendar: calendar, shift: shift, backplanRows: backplanRows };
})();
function reversePlan(projectId, deadline, phases) { return Planning.reverse(projectId, deadline, phases); }
function refreshWorkload(asOf) { return Planning.workload(asOf); }