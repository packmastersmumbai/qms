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

// The probe came back BLOCKED for a trigger too, which is surprising enough to
// double-check before abandoning the design. Two innocent explanations:
//   (a) the trigger was created but the owner never completed the OAuth consent
//       screen, so it runs under a partial grant;
//   (b) the trigger's own authMode was LIMITED.
// This reports what the EDITOR sees when the owner runs it by hand — the same
// code path, but with a guaranteed-complete grant behind it.
function probeEditorScopes() {
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
  probe('ScriptApp',   function () { ScriptApp.getProjectTriggers().length; });

  var who = '';
  try { who = Session.getEffectiveUser().getEmail() || '(blank)'; } catch (e) { who = '(unreadable)'; }
  var triggers = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      triggers.push(t.getHandlerFunction());
    });
  } catch (e) { triggers.push('(unreadable: ' + e.message.slice(0, 40) + ')'); }

  PropertiesService.getScriptProperties().setProperty('pm.probe.editorScopes',
    JSON.stringify({
      at: Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
      as: who, reach: lines.join('  '), triggers: triggers.join(',')
    }));
  return lines.join('  ') + '   as=' + who + '   triggers=[' + triggers.join(',') + ']';
}

function readEditorProbe() {
  var raw = PropertiesService.getScriptProperties().getProperty('pm.probe.editorScopes');
  if (!raw) return 'No editor probe yet — run probeEditorScopes() in the Apps Script editor.';
  var o = JSON.parse(raw);
  var out = ['EDITOR SCOPE PROBE (run by the owner, by hand)', ''];
  out.push('ran at      : ' + o.at);
  out.push('executed as : ' + o.as);
  out.push('reach       : ' + o.reach);
  out.push('triggers    : ' + o.triggers);
  out.push('');
  var driveOk = o.reach.indexOf('DriveApp=WORKS') >= 0;
  var fetchOk = o.reach.indexOf('UrlFetchApp=WORKS') >= 0;
  out.push(driveOk && fetchOk
    ? 'VERDICT: the OWNER has the scopes. The earlier trigger probe was run\n' +
      'under an incomplete grant — re-run installProbeTrigger() now that consent\n' +
      'is on record, and the queue-and-drain design is viable after all.'
    : 'VERDICT: even a hand-run in the editor is restricted. The project itself\n' +
      'is missing the grant — check that the consent screen was actually\n' +
      'accepted, and that no admin policy blocks Drive/external requests.');
  return out.join('\n');
}

// Exact error text, not a classification. "You do not have permission to call X"
// is what Apps Script emits when a scope is missing from the GRANT. If instead
// the consent screen never listed the scope, the message is identical — so the
// distinguishing evidence is WHICH scopes made it into the token, which
// tokeninfo answers directly. UrlFetchApp is itself blocked, so this asks the
// only question it still can: what does each call actually say?
function probeScopeErrors() {
  var out = [];
  function raw(label, fn) {
    try { fn(); out.push(label + ': OK'); }
    catch (e) { out.push(label + ': ' + e.message.slice(0, 150)); }
  }
  raw('DriveApp.getRootFolder', function () { DriveApp.getRootFolder().getName(); });
  raw('UrlFetchApp.fetch',      function () { UrlFetchApp.fetch('https://www.google.com/generate_204'); });
  raw('Session.getEffectiveUser', function () { Session.getEffectiveUser().getEmail(); });
  PropertiesService.getScriptProperties()
    .setProperty('pm.probe.scopeErrors', JSON.stringify({ lines: out }));
  return out.join('\n');
}
function readScopeErrors() {
  var raw = PropertiesService.getScriptProperties().getProperty('pm.probe.scopeErrors');
  if (!raw) return 'Run probeScopeErrors() in the editor first.';
  return 'RAW SCOPE ERRORS\n\n' + JSON.parse(raw).lines.join('\n\n');
}

// Under drive.file, which Drive operations actually work?
// This is the question that decides whether the whole no-verification plan is
// viable: drive.file covers files the SCRIPT created, but the QMS Data folder
// was created by a HUMAN, so opening it by id may still be refused. If so, the
// fix is to let the script CREATE its own folder rather than adopt an existing
// one — which drive.file does allow.
function probeDriveFile() {
  var out = [];
  function step(label, fn) {
    try { var v = fn(); out.push(label + ': OK' + (v ? '  ' + String(v).slice(0, 60) : '')); return v; }
    catch (e) { out.push(label + ': FAIL ' + e.message.slice(0, 90)); return null; }
  }
  // 1. Can we create a folder at Drive root? (drive.file should allow this)
  var made = step('createFolder (own)', function () {
    var f = DriveApp.createFolder('PM_QMS_SCOPE_PROBE_' + new Date().getTime());
    return f.getId();
  });
  // 2. Can we re-open what we just created? (drive.file: yes)
  step('getFolderById (own)', function () {
    return made ? DriveApp.getFolderById(made).getName() : 'skipped';
  });
  // 3. Can we create a file inside it and share it?
  var file = step('createFile + setSharing', function () {
    if (!made) return 'skipped';
    var blob = Utilities.newBlob('probe', 'text/plain', 'probe.txt');
    var fl = DriveApp.getFolderById(made).createFile(blob);
    fl.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return fl.getUrl();
  });
  // 4. The spreadsheet's own parent — the fallback getProjectFolder_ now uses.
  step('spreadsheet parent', function () {
    var ps = DriveApp.getFileById(getSpreadsheet().getId()).getParents();
    return ps.hasNext() ? ps.next().getName() : '(none)';
  });
  // 5. An EXISTING pinned folder the script did not create.
  step('pinned QMS Data parent', function () {
    var id = PropertiesService.getScriptProperties().getProperty(QMS_DATA_PARENT_PROP_);
    if (!id) return '(nothing pinned)';
    return DriveApp.getFolderById(id).getName();
  });
  // 6. Outbound network — Telegram / QR depend on it.
  step('UrlFetchApp', function () {
    return 'HTTP ' + UrlFetchApp.fetch('https://www.google.com/generate_204',
      { muteHttpExceptions: true }).getResponseCode();
  });
  // cleanup
  step('cleanup', function () {
    if (made) DriveApp.getFolderById(made).setTrashed(true);
    return 'trashed';
  });
  PropertiesService.getScriptProperties()
    .setProperty('pm.probe.driveFile', JSON.stringify({ lines: out }));
  return out.join('\n');
}
function readDriveFileProbe() {
  var raw = PropertiesService.getScriptProperties().getProperty('pm.probe.driveFile');
  if (!raw) return 'Run probeDriveFile() in the Apps Script editor first.';
  var L = JSON.parse(raw).lines;
  var ok = L.filter(function (l) { return l.indexOf(': OK') >= 0; }).length;
  return 'DRIVE.FILE CAPABILITY PROBE\n\n' + L.join('\n') +
    '\n\n' + ok + ' of ' + L.length + ' operations succeeded.';
}

// The drive.file probe failed on createFolder, which drive.file SHOULD allow.
// That points at the consent screen still carrying the old scope set rather than
// the new manifest. UrlFetchApp now works, so the token IS being refreshed —
// which means we can finally ask Google directly what it contains.
function probeGrantedScopes() {
  var out = [];
  try {
    var r = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' +
      encodeURIComponent(ScriptApp.getOAuthToken()), { muteHttpExceptions: true });
    var j = JSON.parse(r.getContentText());
    var scopes = String(j.scope || '').split(/\s+/).filter(Boolean).sort();
    out.push('GRANTED SCOPES (' + scopes.length + '):');
    scopes.forEach(function (s) {
      out.push('   ' + s.replace('https://www.googleapis.com/auth/', ''));
    });
    out.push('');
    var has = function (x) { return scopes.indexOf('https://www.googleapis.com/auth/' + x) >= 0; };
    out.push('drive            : ' + (has('drive')            ? 'GRANTED' : 'no'));
    out.push('drive.file       : ' + (has('drive.file')       ? 'GRANTED' : 'NO  <- needed, missing'));
    out.push('script.external_request: ' + (has('script.external_request') ? 'GRANTED' : 'no'));
    out.push('userinfo.email   : ' + (has('userinfo.email')   ? 'GRANTED' : 'no'));
    out.push('');
    out.push(has('drive.file') || has('drive')
      ? 'VERDICT: a Drive scope IS granted — the failures are something else.'
      : 'VERDICT: NO Drive scope in the token. The consent screen has not been\n' +
        'updated with drive.file, or consent was not re-accepted after the change.\n' +
        'Every DriveApp call will fail until it is.');
  } catch (e) {
    out.push('THREW: ' + e.message);
  }
  PropertiesService.getScriptProperties()
    .setProperty('pm.probe.granted', JSON.stringify({ lines: out }));
  return out.join('\n');
}
function readGrantedScopes() {
  var raw = PropertiesService.getScriptProperties().getProperty('pm.probe.granted');
  if (!raw) return 'Run probeGrantedScopes() in the Apps Script editor first.';
  return JSON.parse(raw).lines.join('\n');
}

// DriveApp.createFolder demands the RESTRICTED auth/drive scope even to create a
// brand-new folder — a limitation of the DriveApp wrapper, not of Drive itself.
// The Drive REST API honours drive.file correctly: a file or folder the app
// creates is its own, and no verification is required.
//
// UrlFetchApp + ScriptApp.getOAuthToken are both granted, so we can call REST
// directly. This proves the whole chain before any of it is built on.
function probeDriveRest() {
  var out = [];
  var tok = ScriptApp.getOAuthToken();
  function api(label, url, opts) {
    try {
      var o = opts || {};
      o.muteHttpExceptions = true;
      o.headers = o.headers || {};
      o.headers.Authorization = 'Bearer ' + tok;
      var r = UrlFetchApp.fetch(url, o);
      var code = r.getResponseCode();
      var body = r.getContentText();
      out.push(label + ': HTTP ' + code + '  ' + body.slice(0, 120));
      return (code >= 200 && code < 300) ? JSON.parse(body) : null;
    } catch (e) { out.push(label + ': THREW ' + e.message.slice(0, 80)); return null; }
  }

  // 1. Create a folder via REST.
  var folder = api('REST create folder',
    'https://www.googleapis.com/drive/v3/files',
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ name: 'PM_QMS_REST_PROBE',
                                mimeType: 'application/vnd.google-apps.folder' }) });

  // 2. Upload a file into it (multipart).
  var fileId = null;
  if (folder && folder.id) {
    var boundary = 'pmqmsboundary';
    var meta = JSON.stringify({ name: 'probe.txt', parents: [folder.id] });
    var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
               meta + '\r\n--' + boundary + '\r\nContent-Type: text/plain\r\n\r\n' +
               'hello\r\n--' + boundary + '--';
    var up = api('REST upload file',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: body });
    if (up && up.id) fileId = up.id;
  }

  // 3. Share it — the PDFs and images must be openable by link.
  if (fileId) {
    api('REST share anyone',
      'https://www.googleapis.com/drive/v3/files/' + fileId + '/permissions',
      { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ role: 'reader', type: 'anyone' }) });
  }

  // 4. Can DriveApp now SEE the file REST created? (it should — the app owns it)
  if (fileId) {
    try { out.push('DriveApp.getFileById(own): OK ' + DriveApp.getFileById(fileId).getName()); }
    catch (e) { out.push('DriveApp.getFileById(own): FAIL ' + e.message.slice(0, 70)); }
  }

  // cleanup
  if (folder && folder.id) {
    api('REST delete folder',
      'https://www.googleapis.com/drive/v3/files/' + folder.id, { method: 'delete' });
  }

  PropertiesService.getScriptProperties()
    .setProperty('pm.probe.driveRest', JSON.stringify({ lines: out }));
  return out.join('\n');
}
function readDriveRest() {
  var raw = PropertiesService.getScriptProperties().getProperty('pm.probe.driveRest');
  if (!raw) return 'Run probeDriveRest() in the Apps Script editor first.';
  var L = JSON.parse(raw).lines;
  return 'DRIVE REST API PROBE (drive.file)\n\n' + L.join('\n') + '\n\n' +
    (L.join(' ').indexOf('REST create folder: HTTP 200') >= 0
      ? 'VERDICT: REST works under drive.file — Drive features can be restored\n' +
        'with no verification and no restricted scope.'
      : 'VERDICT: REST also refused. See the codes above.');
}
