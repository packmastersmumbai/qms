// ============================================================
// _OutboxProbe.js — does a TRIGGER really get the scopes the web app cannot?
//
// The whole queue-and-drain design rests on one assumption: a time-driven
// trigger executes as the project owner with the full manifest scopes, while
// the ANYONE_ANONYMOUS web app gets a restricted token (spreadsheets only).
// That assumption is worth one cheap experiment before building on it.
//
// The trigger writes its own scope-reach report into Script Properties; the
// web app then reads that property back out. Properties are readable under the
// restricted token, so the result survives the boundary the report is about.
// ============================================================

var OUTBOX_PROBE_PROP_ = 'pm.probe.triggerScopes';

// Runs FROM A TRIGGER. Records what it could reach.
function probeTriggerScopes() {
  var lines = [];
  function probe(label, fn) {
    try { fn(); lines.push(label + '=WORKS'); }
    catch (e) {
      lines.push(label + '=' + (/do not have permission|Required permissions/i.test(e.message)
        ? 'BLOCKED' : 'ERR:' + e.message.slice(0, 40)));
    }
  }
  probe('DriveApp',    function () { DriveApp.getRootFolder().getName(); });
  probe('UrlFetchApp', function () {
    UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  });
  probe('Session',     function () { Session.getEffectiveUser().getEmail(); });
  probe('Sheets',      function () { getSpreadsheet().getName(); });

  var who = '';
  try { who = Session.getEffectiveUser().getEmail() || '(blank)'; } catch (e) { who = '(unreadable)'; }

  PropertiesService.getScriptProperties().setProperty(OUTBOX_PROBE_PROP_,
    JSON.stringify({
      at: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
      as: who,
      reach: lines.join('  ')
    }));
}

// Install a one-shot trigger a minute out, so the probe runs without anyone
// having to open the editor.
function installProbeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'probeTriggerScopes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('probeTriggerScopes').timeBased().after(60 * 1000).create();
  return 'probe trigger installed — fires in ~60s';
}

// Read the probe's verdict back from the web app (restricted token).
function readProbeResult() {
  var raw = PropertiesService.getScriptProperties().getProperty(OUTBOX_PROBE_PROP_);
  if (!raw) {
    return 'No probe result yet.\n\n' +
           'The trigger has not run. Install it by running installProbeTrigger()\n' +
           'once in the Apps Script editor, then re-check in ~90 seconds.';
  }
  var o = JSON.parse(raw);
  var out = ['TRIGGER SCOPE PROBE', ''];
  out.push('ran at      : ' + o.at);
  out.push('executed as : ' + o.as);
  out.push('reach       : ' + o.reach);
  out.push('');
  out.push(o.reach.indexOf('DriveApp=WORKS') >= 0 && o.reach.indexOf('UrlFetchApp=WORKS') >= 0
    ? 'VERDICT: CONFIRMED — a trigger has the scopes the web app lacks.\n' +
      'The queue-and-drain design is viable.'
    : 'VERDICT: the trigger is ALSO restricted. Queue-and-drain will not help;\n' +
      'the outbound work needs an external host instead.');
  return out.join('\n');
}
