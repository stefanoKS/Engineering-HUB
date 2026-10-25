var Planning = (function () {
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
  function reverse(projectId, deadline, phases) {
    Domain.required('PROJECTS', projectId);
    deadline = Domain.date(deadline, 'Deadline');
    if (!deadline) Domain.fail('Deadline is required');
    phases = phases || Database.read('PHASE_TEMPLATES');
    if (!phases.length) Domain.fail('At least one planning phase is required');
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
    var rows = [['プロジェクトID', 'フェーズID', 'フェーズ', '開始日', '終了日', '状態']];
    phases.forEach(function (phase) {
      var item = schedule[phase.Phase_ID];
      rows.push([projectId, item.Phase_ID, item.Phase_Name, item.Start_Date, item.End_Date, item.Status]);
    });
    Database.writeGenerated('BACKPLAN', rows);
    return phases.map(function (phase) { return schedule[phase.Phase_ID]; });
  }
  function workload(asOf) {
    asOf = Domain.date(asOf || Domain.today());
    var cal = calendar(Database.read('HOLIDAYS'));
    var weekday = new Date(asOf + 'T00:00:00Z').getUTCDay();
    var monday = shift(asOf, -((weekday + 6) % 7)), days = [];
    for (var i = 0; i < 7; i++) {
      var day = shift(monday, i);
      if (cal.working(day)) days.push(day);
    }
    var members = Database.read('MEMBERS').filter(function (member) { return member.Active === true; });
    var tasks = Database.read('TASKS'), rows = [['メンバーID', 'メンバー', '週開始日', '残作業時間', '週容量', '負荷率', '未見積タスク数']];
    var result = members.map(function (member) {
      var hours = 0, unknown = 0;
      tasks.forEach(function (task) {
        if (task.Owner_Member_ID !== member.Member_ID || task.Status === 'Done' || task.Status === 'Cancelled') return;
        if (task.Estimated_Hours === '' || task.Estimated_Hours === null || task.Estimated_Hours === undefined) { unknown++; return; }
        if (!task.Planned_Start || !task.Due_Date) { unknown++; return; }
        var start = Domain.date(task.Planned_Start), end = Domain.date(task.Due_Date);
        if (end < asOf) start = asOf;
        else if (start < asOf) start = asOf;
        if (end < start) end = start;
        var total = 0, overlap = 0;
        for (var cursor = start; cursor <= end; cursor = shift(cursor, 1)) {
          if (cal.working(cursor)) { total++; if (days.indexOf(cursor) !== -1) overlap++; }
        }
        var remaining = Math.max(0, Number(task.Estimated_Hours) - Number(task.Actual_Hours || 0));
        if (total) hours += remaining * overlap / total;
      });
      hours = Math.round(hours * 100) / 100;
      var capacity = Number(member.Weekly_Capacity_Hours || 0) * days.length / 5;
      var item = { Member_ID: member.Member_ID, Week_Start: monday, Remaining_Hours: hours, Capacity_Hours: capacity, Utilization: capacity ? hours / capacity : null, Unknown_Tasks: unknown };
      rows.push([member.Member_ID, member.Name, monday, hours, capacity, item.Utilization === null ? '' : item.Utilization, unknown]);
      return item;
    });
    Database.writeGenerated('WORKLOAD', rows);
    return result;
  }
  return { reverse: reverse, workload: workload, calendar: calendar, shift: shift };
})();
function reversePlan(projectId, deadline, phases) { return Planning.reverse(projectId, deadline, phases); }
function refreshWorkload(asOf) { return Planning.workload(asOf); }
