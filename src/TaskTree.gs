/**
 * Nested tasks (作業の階層).
 *
 * A task may contain subtasks: at most three levels in total (task, subtask, sub-subtask).
 * `Parent_Task_ID` describes organisation only; `Dependency_IDs` remains the separate
 * sequencing constraint and the two are never mixed.
 *
 * A task with children is a work container, not an extra unit of work. Its stored
 * `Status`/`Progress_Percent` stop being authoritative: progress is derived from the leaf
 * work, so a parent and its children are never counted twice. The stored columns are left
 * untouched, which keeps every write a single row update.
 *
 * A task that already carries recorded work, approval or completion history is never
 * silently turned into a container; the manager must either start a fresh container task
 * or use a subproject.
 *
 * Reconciliation is index based (`buildIndex`) so a list of a few thousand tasks is walked
 * once instead of once per row.
 */
var TaskTree = (function () {
  var MAX_DEPTH = 3;
  var CANCELLED = 'Cancelled';
  var DONE = 'Done';

  function text(value) { return String(value === undefined || value === null ? '' : value).trim(); }

  function fail(message) { Domain.fail(message); }

  function parentOf(task) { return text(task && task.Parent_Task_ID); }

  function byId(tasks) {
    var index = Object.create(null);
    (tasks || []).forEach(function (task) { if (task && task.Task_ID) index[task.Task_ID] = task; });
    return index;
  }

  /** One pass over the list: rows, children and parent links. */
  function buildIndex(tasks) {
    var index = {byId: Object.create(null), children: Object.create(null), parents: Object.create(null)};
    (tasks || []).forEach(function (task) {
      if (!task || !task.Task_ID) return;
      index.byId[task.Task_ID] = task;
      index.parents[task.Task_ID] = parentOf(task);
    });
    Object.keys(index.parents).forEach(function (id) {
      var parent = index.parents[id];
      // A dangling or self parent is treated as a root, so malformed data cannot loop.
      if (!parent || parent === id || !index.byId[parent]) return;
      if (!index.children[parent]) index.children[parent] = [];
      index.children[parent].push(id);
    });
    return index;
  }

  function childrenMap(tasks) { return buildIndex(tasks).children; }

  function containerIds(tasks) { return buildIndex(tasks).children; }

  function isContainer(taskId, children) { return !!(children && children[text(taskId)] && children[text(taskId)].length); }

  /** 1 = top-level task. Throws on a cycle or on an over-long chain instead of looping. */
  function levelOf(taskId, index) {
    var level = 1, seen = Object.create(null), cursor = text(taskId);
    while (cursor) {
      var next = index && index.parents ? index.parents[cursor] : (index && index[cursor] ? parentOf(index[cursor]) : '');
      if (!next) break;
      if (seen[cursor]) throw new Error('タスクの階層が循環しています');
      seen[cursor] = true;
      cursor = next;
      level++;
      if (level > MAX_DEPTH + 2) throw new Error('タスクの階層が循環しています');
    }
    return level;
  }

  /** Deepest nesting below a task; 0 means the task has no children. */
  function heightOf(taskId, children, trail) {
    var path = trail || Object.create(null);
    var id = text(taskId);
    if (path[id]) throw new Error('タスクの階層が循環しています');
    path[id] = true;
    var kids = (children && children[id]) || [];
    var deepest = 0;
    kids.forEach(function (kid) { deepest = Math.max(deepest, heightOf(kid, children, path)); });
    delete path[id];
    return kids.length ? deepest + 1 : 0;
  }

  function isAncestor(candidateId, ancestorId, index) {
    var seen = Object.create(null), cursor = text(ancestorId), guard = 0;
    while (cursor) {
      if (cursor === text(candidateId)) return true;
      if (seen[cursor]) throw new Error('タスクの階層が循環しています');
      seen[cursor] = true;
      var parent = index.parents ? index.parents[cursor] : (index[cursor] ? parentOf(index[cursor]) : '');
      if (!parent) return false;
      cursor = parent;
      if (guard++ > MAX_DEPTH + 2) throw new Error('タスクの階層が循環しています');
    }
    return false;
  }

  /** Recorded work makes a task unsuitable as a container without an explicit decision. */
  function hasRecordedWork(task) {
    if (!task) return false;
    if (Number(task.Actual_Hours) > 0) return true;
    if (Number(task.Progress_Percent) > 0) return true;
    if (text(task.Completed_At)) return true;
    return text(task.Status) === DONE;
  }

  function assertConvertible(task) {
    if (!hasRecordedWork(task)) return true;
    fail('実績・承認・完了履歴のあるタスクはコンテナにできません。新しい親タスクかサブプロジェクトを作成してください');
    return false;
  }

  /**
   * Validates the organisational hierarchy for a candidate row.
   *
   * `rows` must contain the candidate (and must not contain the pre-edit copy of the
   * replaced row), so both the new parent link and the existing subtree are checked before
   * anything is written.
   */
  function validate(candidate, before, rows) {
    var index = buildIndex(rows);
    var id = text(candidate.Task_ID) || '__new_task__';
    var parentId = parentOf(candidate);
    var level = 1;

    if (parentId) {
      if (parentId === id) fail('タスクを自身の親にはできません');
      var parent = index.byId[parentId];
      if (!parent) fail('親タスクが見つかりません: ' + parentId);
      if (text(parent.Project_ID) !== text(candidate.Project_ID)) {
        fail('親タスクと子タスクは同じプロジェクトに属している必要があります');
      }
      if (text(parent.Subproject_ID || '') !== text(candidate.Subproject_ID || '')) {
        fail('親タスクと子タスクは同じサブプロジェクトに属している必要があります');
      }
      if (isAncestor(id, parentId, index)) fail('タスクの親子関係が循環しています');
      level = levelOf(parentId, index) + 1;
      if (level > MAX_DEPTH) fail('タスクの階層は' + MAX_DEPTH + '階層までです');
      var reparented = !before || parentOf(before) !== parentId;
      if (reparented) assertConvertible(parent);
    }

    if (!before) return {level: level};
    var kids = index.children[id] || [];
    if (kids.length) {
      if (text(candidate.Status) !== text(before.Status) ||
          Number(candidate.Progress_Percent) !== Number(before.Progress_Percent)) {
        fail('子タスクのあるタスクの状態と進捗は子タスクから算出されます');
      }
      if (text(candidate.Project_ID) !== text(before.Project_ID) ||
          text(candidate.Subproject_ID || '') !== text(before.Subproject_ID || '')) {
        fail('子タスクのあるタスクは別のプロジェクトやサブプロジェクトへ移動できません');
      }
      if (parentOf(before) !== parentId) {
        var deepest = heightOf(id, index.children);
        if (level + deepest > MAX_DEPTH) fail('タスクの階層は' + MAX_DEPTH + '階層までです');
      }
    }
    return {level: level};
  }

  /** Leaf work only: a task that has children is never counted as its own unit of work. */
  function leaves(tasks) {
    var index = buildIndex(tasks);
    return (tasks || []).filter(function (task) { return !isContainer(task.Task_ID, index.children); });
  }

  function descendantLeavesIn(taskId, index) {
    var out = [], seen = Object.create(null);
    (function walk(node) {
      (index.children[node] || []).forEach(function (kid) {
        if (seen[kid]) return;
        seen[kid] = true;
        walk(kid);
        if (!isContainer(kid, index.children) && index.byId[kid]) out.push(index.byId[kid]);
      });
    }(text(taskId)));
    return out;
  }

  function descendantLeaves(taskId, tasks) { return descendantLeavesIn(taskId, buildIndex(tasks)); }

  /** Progress of a container task, derived from its leaf work only. */
  function rollup(taskId, tasks) {
    return Progress.rollup(descendantLeavesIn(taskId, buildIndex(tasks)));
  }

  /** Derived status of a container task; null means "not derived / no leaf work". */
  function derivedStatusIn(taskId, index) {
    var work = descendantLeavesIn(taskId, index).filter(function (task) { return text(task.Status) !== CANCELLED; });
    if (!work.length) return null;
    return work.every(function (task) { return text(task.Status) === DONE; }) ? DONE : null;
  }

  function derivedStatus(taskId, tasks) { return derivedStatusIn(taskId, buildIndex(tasks)); }

  /** Display values for one task from a prebuilt index: containers report derived completion. */
  function viewIn(task, index) {
    var container = isContainer(task && task.Task_ID, index.children);
    var level = 1;
    try { level = levelOf(task && task.Task_ID, index); } catch (error) { level = 1; }
    if (!container) {
      return {container: false, progress: Progress.percent(task), status: text(task && task.Status),
        depth: Math.max(0, level - 1)};
    }
    var rolled = Progress.rollup(descendantLeavesIn(task.Task_ID, index));
    var derived = derivedStatusIn(task.Task_ID, index);
    return {
      container: true,
      progress: rolled.calculated ? rolled.percent : Progress.percent(task),
      status: derived || text(task.Status),
      depth: Math.max(0, level - 1)
    };
  }

  /** Display values for one task; convenience wrapper that builds the index itself. */
  function view(task, tasks) { return viewIn(task, buildIndex(tasks || [])); }

  function childrenOf(taskId, tasks) {
    return (tasks || []).filter(function (task) { return parentOf(task) === text(taskId); });
  }

  return {
    MAX_DEPTH: MAX_DEPTH,
    parentOf: parentOf,
    byId: byId,
    buildIndex: buildIndex,
    childrenMap: childrenMap,
    containerIds: containerIds,
    isContainer: isContainer,
    levelOf: levelOf,
    heightOf: heightOf,
    hasRecordedWork: hasRecordedWork,
    validate: validate,
    leaves: leaves,
    descendantLeaves: descendantLeaves,
    descendantLeavesIn: descendantLeavesIn,
    rollup: rollup,
    derivedStatus: derivedStatus,
    view: view,
    viewIn: viewIn,
    childrenOf: childrenOf
  };
}());
