// ============================================================
// DwmTasks.gs — task CRUD + permission helpers + dashboard
// ============================================================

function generateTaskId_() {
  var d = new Date();
  var ymd = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyyMMdd');
  var n = Math.floor(Math.random() * 10000);
  return 'T-' + ymd + '-' + pad_(n, 4);
}

function canManageTask_(actor, task) {
  if (!actor) return false;
  if (actor.role === DWM_ROLES.MASTER || actor.role === DWM_ROLES.OWNER) return true;
  if (task.assignedTo === actor.userId || task.createdBy === actor.userId) return true;
  if (actor.role === DWM_ROLES.ADMIN) {
    var assignee = getUserById_(task.assignedTo);
    if (assignee && assignee.role === DWM_ROLES.USER) return true;
  }
  return false;
}

function rowToTask_(row) {
  return {
    taskId: row[0], title: row[1], description: row[2],
    projectId: row[3], categoryId: row[4], assignedTo: row[5],
    isShared: row[6] === true, status: row[7], priority: row[8],
    dueDate: row[9] ? Utilities.formatDate(new Date(row[9]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
    linkedRecord: row[10], createdBy: row[11], createdAt: row[12], updatedAt: row[13]
  };
}

function findTaskRow_(taskId) {
  var sh = getSpreadsheet().getSheetByName(DWM_SHEETS.TASKS);
  if (!sh || sh.getLastRow() < 2) return null;
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] === taskId) return { row: r + 1, data: data[r], task: rowToTask_(data[r]) };
  }
  return null;
}

function getTask(sessionId, taskId) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    var found = findTaskRow_(taskId);
    if (!found) return { status:'error', message:'Task not found.' };
    if (!found.task.isShared && found.task.assignedTo !== s.userId && !canManageTask_(s, found.task)) {
      return { status:'error', message:'Not allowed.' };
    }
    return { status:'success', task: found.task };
  } catch (e) {
    logAudit_('SYSTEM','ERROR','getTask: ' + e);
    return { status:'error', message: e.message };
  }
}

// Internal: create a task with a pre-validated session object (avoids double sheet scan).
// Called by autoQmsTask_ (which already validated via validateSessionFast_) and by createTask.
function createTask_(s, data) {
  if (!data || !data.title || !data.projectId || !data.categoryId) {
    return { status:'error', message:'Title, project, and category are required.' };
  }
  var assignedTo = data.assignedTo || s.userId;
  if (assignedTo !== s.userId) {
    if (s.role === DWM_ROLES.USER) return { status:'error', message:'Cannot assign tasks to others.' };
    if (s.role === DWM_ROLES.ADMIN) {
      var u = getUserById_(assignedTo);
      if (!u || u.role !== DWM_ROLES.USER) return { status:'error', message:'Admins can only assign tasks to user role.' };
    }
  }
  var isShared = data.isShared === true;
  if (isShared && s.role === DWM_ROLES.USER) return { status:'error', message:'Cannot create shared tasks.' };

  var taskId = generateTaskId_();
  var now = new Date().toISOString();
  var sh = getSpreadsheet().getSheetByName(DWM_SHEETS.TASKS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sh.appendRow([
      taskId, data.title, data.description || '',
      data.projectId, data.categoryId, assignedTo, isShared,
      DWM_TASK_STATUS.OPEN, data.priority || DWM_PRIORITY.MEDIUM,
      data.dueDate || '', data.linkedRecord || '',
      s.userId, now, now
    ]);
  } finally {
    lock.releaseLock();
  }
  logAudit_(s.userId, 'TASK_CREATE', taskId);
  return { status:'success', taskId: taskId };
}

function createTask(sessionId, data) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    return createTask_(s, data);
  } catch (e) {
    logAudit_('SYSTEM','ERROR','createTask: ' + e);
    return { status:'error', message: e.message };
  }
}

function updateTask(sessionId, taskId, data) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    var found = findTaskRow_(taskId);
    if (!found) return { status:'error', message:'Task not found.' };
    if (!canManageTask_(s, found.task)) return { status:'error', message:'Not allowed.' };

    var sh = getSpreadsheet().getSheetByName(DWM_SHEETS.TASKS);
    var fields = ['title','description','projectId','categoryId','assignedTo','isShared','status','priority','dueDate','linkedRecord'];
    var cols   = [ 2,        3,            4,           5,            6,            7,         8,        9,         10,        11           ];
    fields.forEach(function(f, i) {
      if (data.hasOwnProperty(f)) sh.getRange(found.row, cols[i]).setValue(data[f]);
    });
    sh.getRange(found.row, 14).setValue(new Date().toISOString());
    logAudit_(s.userId, 'TASK_UPDATE', taskId);
    return { status:'success' };
  } catch (e) {
    logAudit_('SYSTEM','ERROR','updateTask: ' + e);
    return { status:'error', message: e.message };
  }
}

function changeStatus(sessionId, taskId, status) {
  var valid = [DWM_TASK_STATUS.OPEN, DWM_TASK_STATUS.IN_PROGRESS, DWM_TASK_STATUS.DONE, DWM_TASK_STATUS.NOT_DONE];
  if (valid.indexOf(status) < 0) return { status:'error', message:'Invalid status.' };
  return updateTask(sessionId, taskId, { status: status });
}

function deleteTask(sessionId, taskId) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    var found = findTaskRow_(taskId);
    if (!found) return { status:'error', message:'Task not found.' };
    if (found.task.assignedTo === s.userId && s.role === DWM_ROLES.USER) {
      return { status:'error', message:'Users cannot delete tasks. Mark as Not Done instead.' };
    }
    if (!canManageTask_(s, found.task)) return { status:'error', message:'Not allowed.' };
    getSpreadsheet().getSheetByName(DWM_SHEETS.TASKS).deleteRow(found.row);
    logAudit_(s.userId, 'TASK_DELETE', taskId);
    return { status:'success' };
  } catch (e) {
    logAudit_('SYSTEM','ERROR','deleteTask: ' + e);
    return { status:'error', message: e.message };
  }
}

function getDashboard(sessionId) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    var sh = getSpreadsheet().getSheetByName(DWM_SHEETS.TASKS);
    var data = sh.getLastRow() < 2 ? [] : sh.getDataRange().getValues();
    var own = [], shared = [];
    for (var r = 1; r < data.length; r++) {
      var t = rowToTask_(data[r]);
      if (t.status === DWM_TASK_STATUS.DONE || t.status === DWM_TASK_STATUS.NOT_DONE) {
        if (!isUpdatedToday_(data[r][13])) continue;
      }
      if (t.isShared) shared.push(t);
      else if (t.assignedTo === s.userId) own.push(t);
    }
    return { status:'success', shared: shared, own: own, activeTimer: getActiveTimerForUser_(s.userId) };
  } catch (e) {
    logAudit_('SYSTEM','ERROR','getDashboard: ' + e);
    return { status:'error', message: e.message };
  }
}

// Single round-trip: masters + tasks + active timer + current user
function getDashboardFull(sessionId) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    var ss = getSpreadsheet();
    var projects = readActiveRows_(ss.getSheetByName(DWM_SHEETS.PROJECTS),  [0,1]);
    var cats     = readActiveRows_(ss.getSheetByName(DWM_SHEETS.CATEGORIES), [0,1]);
    var sh = ss.getSheetByName(DWM_SHEETS.TASKS);
    var data = sh.getLastRow() < 2 ? [] : sh.getDataRange().getValues();
    var own = [], shared = [];
    for (var r = 1; r < data.length; r++) {
      var t = rowToTask_(data[r]);
      if (t.status === DWM_TASK_STATUS.DONE || t.status === DWM_TASK_STATUS.NOT_DONE) {
        if (!isUpdatedToday_(data[r][13])) continue;
      }
      if (t.isShared) shared.push(t);
      else if (t.assignedTo === s.userId) own.push(t);
    }
    return {
      status: 'success',
      me: { userId: s.userId, name: s.name, role: s.role },
      projects: projects, categories: cats,
      shared: shared, own: own,
      activeTimer: getActiveTimerForUser_(s.userId)
    };
  } catch (e) {
    logAudit_('SYSTEM','ERROR','getDashboardFull: ' + e);
    return { status:'error', message: e.message };
  }
}

function isUpdatedToday_(iso) {
  if (!iso) return false;
  var d = new Date(iso);
  var today = new Date();
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

function getActiveTimerForUser_(userId) {
  var sh = getSpreadsheet().getSheetByName(DWM_SHEETS.TIMELOGS);
  if (!sh || sh.getLastRow() < 2) return null;
  var data = sh.getDataRange().getValues();
  for (var r = data.length - 1; r >= 1; r--) {
    if (data[r][1] === userId && !data[r][5]) {
      return { logId: data[r][0], taskId: data[r][2], startTime: data[r][4] };
    }
  }
  return null;
}

function getMasters(sessionId) {
  try {
    var s = validateSession(sessionId);
    if (!s) return { status:'error', message:'Session expired. Please log in again.' };
    var ss = getSpreadsheet();
    var projects = readActiveRows_(ss.getSheetByName(DWM_SHEETS.PROJECTS), [0,1]);
    var cats     = readActiveRows_(ss.getSheetByName(DWM_SHEETS.CATEGORIES), [0,1]);
    var assignable = [];
    if (s.role !== DWM_ROLES.USER) {
      var usersSh = ss.getSheetByName(DWM_SHEETS.USERS);
      var data = usersSh.getDataRange().getValues();
      for (var r = 1; r < data.length; r++) {
        if (data[r][4] !== true) continue;
        if (s.role === DWM_ROLES.ADMIN && data[r][3] !== DWM_ROLES.USER && data[r][0] !== s.userId) continue;
        assignable.push({ userId: data[r][0], name: data[r][1], role: data[r][3] });
      }
    } else {
      assignable.push({ userId: s.userId, name: s.name, role: DWM_ROLES.USER });
    }
    return { status:'success', projects: projects, categories: cats, assignableUsers: assignable, me: s };
  } catch (e) {
    logAudit_('SYSTEM','ERROR','getMasters: ' + e);
    return { status:'error', message: e.message };
  }
}

function readActiveRows_(sh, cols) {
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < data.length; r++) {
    if (data[r][2] !== true) continue;
    out.push({ id: data[r][cols[0]], name: data[r][cols[1]] });
  }
  return out;
}
