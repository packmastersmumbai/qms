/**
 * QmsDrive.js — single source of truth for where QMS documents live in Drive.
 *
 * Previously each module called DriveApp.createFolder('QMS/GRN/2026-06'), which
 * creates ONE folder literally named "QMS/GRN/2026-06" at Drive ROOT — hence the
 * flat clutter ("QMS GRN 2026-05", "QMS IQC 2026-06", …) beside the project folder.
 *
 * Now everything nests under the project folder:
 *
 *   <project folder>/
 *     QMS Data/
 *       GRN/2026-06/…pdf
 *       IQC/2026-06/…pdf
 *       IPQC/2026-06/…pdf
 *       OQC/2026-06/…pdf
 *       NCR Photos/…
 *       Customer Return Photos/…
 *
 * Drive file IDs (and therefore the URLs stored in the sheets) are stable across a
 * move, so migrating existing folders does not break any saved record link.
 */

var QMS_DATA_ROOT_ = 'QMS Data';

// Script Property holding the Drive folder ID that should contain "QMS Data".
// Set once via setQmsDataParent(folderId). If unset we fall back to the "PM QMS"
// folder at Drive root, and finally to the spreadsheet's own parent.
var QMS_DATA_PARENT_PROP_ = 'pm.drive.qmsDataParentId';

/**
 * The folder that should CONTAIN "QMS Data".
 * Resolution order: configured ID → a root folder literally named "PM QMS" →
 * the spreadsheet's parent (which, for this deployment, is My Drive root).
 */
// SCOPE NOTE (2026-08-12): the pinned ID is now the PRIMARY path, and the
// root-folder scan is a last resort that is expected never to run in production.
//
// Why it matters: getRootFolder() browses the user's whole Drive, so it forces
// the RESTRICTED https://.../auth/drive scope. Google will not grant a
// restricted scope on a standard GCP project until the app passes OAuth
// verification — which is what currently blocks images, PDFs and QR codes.
//
// Every other call this project makes (getFileById on files it created,
// createFile, createFolder, makeCopy) is satisfied by
// https://.../auth/drive.file, which is NON-sensitive and needs no verification.
// So: pin the parent folder once via setQmsDataParent(<id>), and the runtime
// never needs the restricted scope again.
function getProjectFolder_() {
  var props = PropertiesService.getScriptProperties();
  var pinned = props.getProperty(QMS_DATA_PARENT_PROP_);
  if (pinned) {
    try { return DriveApp.getFolderById(pinned); }
    catch (e) { /* stale id — fall through and re-resolve */ }
  }

  // MEASURED 2026-08-12: the granted scope is drive.file, NOT the restricted
  // drive. Under drive.file a script may only touch what IT created — so
  // getFileById(spreadsheet) and getRootFolder() both throw here, and adopting
  // the human-made "PM QMS" folder is impossible by design, not by misconfig.
  //
  // Both were tried and both failed (?diag=drivefile). The route that DOES work
  // is for the script to create its own folder and keep using that. New PDFs and
  // images land there; files already stored elsewhere keep working, because a
  // Drive file id is stable regardless of which folder holds it, and every link
  // in the sheets is stored by id.
  //
  // Restricted-scope alternatives were rejected deliberately: auth/drive needs
  // Google OAuth verification, which this project cannot pass quickly, and it
  // would grant the app the user's ENTIRE Drive to write a few PDFs.
  throw new Error('getProjectFolder_ is unavailable under drive.file. ' +
    'Use qmsFolderId_(...) / DriveRest.js instead — see the note above.');
}

// ── REST folder resolution (drive.file safe) ──────────────────────────
// Returns a folder ID, not a DriveApp Folder object, because DriveApp cannot
// open even the folders it created under drive.file. Everything downstream
// therefore works with ids and DriveRest functions.
function qmsRootFolderId_() {
  var props = PropertiesService.getScriptProperties();
  var pinned = props.getProperty(QMS_DATA_PARENT_PROP_);
  if (pinned) return pinned;
  var id = drvGetOrCreateFolder(QMS_SELF_ROOT_, '');
  props.setProperty(QMS_DATA_PARENT_PROP_, id);
  return id;
}

/** <app root>/QMS Data/<module>/<yyyy-MM> — returns the month folder id. */
function qmsMonthFolderId_(moduleName, date) {
  var ym = Utilities.formatDate(date || new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var dataId = drvGetOrCreateFolder(QMS_DATA_ROOT_, qmsRootFolderId_());
  var modId  = drvGetOrCreateFolder(String(moduleName), dataId);
  return drvGetOrCreateFolder(ym, modId);
}

/** <app root>/QMS Data/Media/<module>/<yyyy-MM> — returns the month folder id. */
function qmsMediaFolderId_(moduleName, date) {
  var ym = Utilities.formatDate(date || new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var dataId  = drvGetOrCreateFolder(QMS_DATA_ROOT_, qmsRootFolderId_());
  var mediaId = drvGetOrCreateFolder('Media', dataId);
  var modId   = drvGetOrCreateFolder(String(moduleName), mediaId);
  return drvGetOrCreateFolder(ym, modId);
}

// The folder the script creates and owns. Named distinctly from the human-made
// "PM QMS" folder so the two are never confused when both exist in Drive.
var QMS_SELF_ROOT_ = 'PM QMS (app)';

/** Pin the QMS Data parent explicitly (e.g. after moving the folder).
 *
 * It used to call DriveApp.getFolderById(folderId) first, purely to validate the
 * id. That check cost MORE permission than the write it guarded: opening a
 * folder the script did not create needs drive.readonly or the restricted
 * drive scope, so under drive.file the validation threw and pinning became
 * impossible — the exact thing pinning exists to avoid.
 *
 * The id is now stored as given. It is verified on FIRST USE instead, by
 * getProjectFolder_, which already treats an unopenable pinned id as stale and
 * re-resolves. A wrong id therefore costs one fallback, not a failed setup.
 */
function setQmsDataParent(folderId) {
  var id = String(folderId || '').trim();
  if (!id) throw new Error('setQmsDataParent: pass the folder id, e.g. setQmsDataParent("1AbC…").');
  // Accept a pasted Drive URL as well as a bare id — the id is the long token.
  var m = id.match(/[-\w]{25,}/);
  if (m) id = m[0];
  PropertiesService.getScriptProperties().setProperty(QMS_DATA_PARENT_PROP_, id);
  return { ok: true, parentId: id,
           note: 'Stored. Verified on first use — run checkQmsDataParent() to test it now.' };
}

/** Is the pinned parent actually reachable under the CURRENT scopes?
 *  Separated from setQmsDataParent so that pinning never depends on a
 *  permission the runtime does not need. */
function checkQmsDataParent() {
  var id = PropertiesService.getScriptProperties().getProperty(QMS_DATA_PARENT_PROP_);
  if (!id) return { ok: false, error: 'Nothing pinned yet.' };
  try {
    var f = DriveApp.getFolderById(id);
    return { ok: true, id: id, name: f.getName() };
  } catch (e) {
    return { ok: false, id: id, error: e.message };
  }
}

/**
 * getOrCreateFolder_(parent, name) already exists in IQC.js (GAS shares global scope).
 * Redefining it here would shadow it, so we only rely on it.
 */

/** <project>/QMS Data */
function getQmsDataFolder_() {
  return getOrCreateFolder_(getProjectFolder_(), QMS_DATA_ROOT_);
}

/**
 * Resolve <project>/QMS Data/<module>/<yyyy-MM>, creating each level as needed.
 * @param {string} moduleName e.g. 'GRN', 'IQC', 'IPQC', 'OQC'
 * @param {Date=} date defaults to now
 */
function getQmsMonthFolder_(moduleName, date) {
  var monthKey = Utilities.formatDate(date || new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var moduleFolder = getOrCreateFolder_(getQmsDataFolder_(), moduleName);
  return getOrCreateFolder_(moduleFolder, monthKey);
}

/**
 * Resolve <project>/QMS Data/<name> for non-month-partitioned stores
 * (NCR photos, Customer Return photos).
 */
function getQmsSubFolder_(name) {
  return getOrCreateFolder_(getQmsDataFolder_(), name);
}

/**
 * Resolve <project>/QMS Data/Media/<module>/<yyyy-MM> for photos and videos.
 * Keeps all binary media alongside the PDFs under one QMS Data root.
 */
function getQmsMediaFolder_(moduleName, date) {
  var monthKey = Utilities.formatDate(date || new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var media = getOrCreateFolder_(getQmsDataFolder_(), 'Media');
  var moduleFolder = getOrCreateFolder_(media, moduleName);
  return getOrCreateFolder_(moduleFolder, monthKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legacy root-level folder names → their new home under QMS Data.
 * The legacy names contain literal '/' characters because they were created via
 * DriveApp.createFolder('QMS/GRN/2026-06').
 */
function legacyFolderTargets_() {
  return [
    { match: /^QMS\/GRN\/(\d{4}-\d{2})$/,  module: 'GRN' },
    { match: /^QMS\/IQC\/(\d{4}-\d{2})$/,  module: 'IQC' },
    { match: /^QMS\/IPQC\/(\d{4}-\d{2})$/, module: 'IPQC' },
    { match: /^QMS\/OQC\/(\d{4}-\d{2})$/,  module: 'OQC' },
    { match: /^PM-QMS — NCR Photos$/,             flat: 'NCR Photos' },
    { match: /^PM-QMS — Customer Return Photos$/, flat: 'Customer Return Photos' }
  ];
}

/**
 * migrateQmsFoldersToQmsData — DRY RUN by default.
 *
 * Scans Drive root for the legacy folders and re-parents them under
 * <project>/QMS Data/<module>/<yyyy-MM> (or /<flat name>).
 *
 * Re-parenting preserves every file ID, so all links stored in the sheets keep
 * working. Idempotent: already-migrated folders are skipped.
 *
 * @param {boolean} apply  pass true to actually move; omit/false to preview only.
 * @returns {{dryRun:boolean, moved:Array, skipped:Array, notFound:Array}}
 */
function migrateQmsFoldersToQmsData(apply) {
  var dryRun = !apply;
  var targets = legacyFolderTargets_();
  var moved = [], skipped = [], errors = [];

  var root = DriveApp.getRootFolder();
  var it = root.getFolders();
  var seen = [];
  while (it.hasNext()) seen.push(it.next());

  seen.forEach(function (folder) {
    var name = folder.getName();
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var m = name.match(t.match);
      if (!m) continue;

      // Where the CONTENTS should end up.
      var destPath = t.flat
        ? QMS_DATA_ROOT_ + '/' + t.flat
        : QMS_DATA_ROOT_ + '/' + t.module + '/' + m[1];

      if (dryRun) {
        var n = 0, peek = folder.getFiles();
        while (peek.hasNext()) { peek.next(); n++; }
        moved.push({ from: name, to: destPath, files: n });
        return;
      }

      try {
        var dest = t.flat
          ? getQmsSubFolder_(t.flat)
          : getQmsMonthFolder_(t.module, new Date(m[1] + '-01T00:00:00+05:30'));

        // Move each file into the destination folder. File IDs — and therefore every
        // URL already stored in the sheets — are unchanged by a move.
        var files = folder.getFiles();
        var count = 0;
        while (files.hasNext()) { files.next().moveTo(dest); count++; }

        // Never trash a folder that still holds subfolders — we only migrate direct
        // files, so a nested folder would be silently lost.
        if (folder.getFolders().hasNext()) {
          moved.push({ from: name, to: destPath, filesMoved: count, note: 'left in place — contains subfolders' });
          return;
        }
        // The legacy shell is now empty. Trash it so root is clean. (Its files live on
        // under QMS Data; trashing an empty folder cannot orphan them.)
        folder.setTrashed(true);
        moved.push({ from: name, to: destPath, filesMoved: count });
      } catch (e) {
        errors.push({ folder: name, error: e.message });
      }
      return;
    }
    skipped.push(name);
  });

  return {
    dryRun: dryRun,
    movedCount: moved.length,
    moved: moved,
    errors: errors,
    skippedRootFolders: skipped.length
  };
}

/** Convenience wrappers for `clasp run`. */
function previewQmsFolderMigration() { return migrateQmsFoldersToQmsData(false); }
function applyQmsFolderMigration()   { return migrateQmsFoldersToQmsData(true); }

/**
 * listDriveRootFolders_ — read-only. Dumps every Drive-root folder name with its file
 * count, plus which legacy pattern (if any) it matches. Use this BEFORE migrating so the
 * patterns in legacyFolderTargets_() are verified against reality, not assumed.
 */
function listDriveRootFolders_() {
  var targets = legacyFolderTargets_();
  var it = DriveApp.getRootFolder().getFolders();
  var rows = [];
  while (it.hasNext()) {
    var f = it.next();
    var name = f.getName();
    var matched = '';
    for (var i = 0; i < targets.length; i++) {
      if (name.match(targets[i].match)) { matched = targets[i].module || targets[i].flat; break; }
    }
    var n = 0, fi = f.getFiles();
    while (fi.hasNext()) { fi.next(); n++; }
    rows.push({ name: name, files: n, matchesLegacyPattern: matched || false });
  }
  rows.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return { rootFolderCount: rows.length, folders: rows };
}

/**
 * relocateQmsDataFolder — move an existing root-level "QMS Data" into the resolved
 * project folder (PM QMS). Idempotent: a no-op once it already lives there.
 * Moving a folder preserves every descendant file ID, so links keep working.
 *
 * @param {boolean} apply pass true to move; omit for a dry run.
 */
function relocateQmsDataFolder(apply) {
  var target = getProjectFolder_();               // where QMS Data SHOULD be
  var root   = DriveApp.getRootFolder();

  // Find a QMS Data sitting directly at root.
  var it = root.getFoldersByName(QMS_DATA_ROOT_);
  if (!it.hasNext()) {
    return { dryRun: !apply, action: 'none', reason: 'no root-level "' + QMS_DATA_ROOT_ + '" found', target: target.getName() };
  }
  var qd = it.next();

  if (target.getId() === root.getId()) {
    return { dryRun: !apply, action: 'none', reason: 'target folder resolves to My Drive root — nothing to nest into' };
  }

  if (!apply) {
    return { dryRun: true, action: 'would move', folder: QMS_DATA_ROOT_, into: target.getName(), targetId: target.getId() };
  }
  qd.moveTo(target);
  PropertiesService.getScriptProperties().setProperty(QMS_DATA_PARENT_PROP_, target.getId());
  return { dryRun: false, action: 'moved', folder: QMS_DATA_ROOT_, into: target.getName(), targetId: target.getId() };
}

/**
 * verifyQmsDocLinks_ — read-only. For each module, read the stored PDF-URL column,
 * extract the Drive file ID, and confirm the file still resolves (and where it lives
 * now). Proves that the folder move did not break any saved link.
 * @param {number=} samplePerModule cap rows checked per module (default 8).
 */
function verifyQmsDocLinks_(samplePerModule) {
  var CAP = samplePerModule || 8;
  var ss = getSpreadsheet();
  // { sheet, urlCol (1-based) } per module
  var specs = [
    { module: 'GRN',  sheet: 'GRN_LOG',  urlCol: 25 },
    { module: 'IQC',  sheet: 'IQC_LOG',  urlCol: 40 },
    { module: 'IPQC', sheet: 'IPQC_Sessions', urlCol: 14 },
    { module: 'OQC',  sheet: 'OQC_LOG', urlCol: 27 }
  ];
  function idFromUrl(u) {
    var m = String(u).match(/[-\w]{25,}/); // Drive file IDs are 25+ url-safe chars
    return m ? m[0] : null;
  }
  var report = [];
  specs.forEach(function (s) {
    var sh = ss.getSheetByName(s.sheet);
    if (!sh) { report.push({ module: s.module, error: 'sheet ' + s.sheet + ' not found' }); return; }
    var last = sh.getLastRow();
    if (last < 2) { report.push({ module: s.module, checked: 0, note: 'no rows' }); return; }
    var col = sh.getRange(2, s.urlCol, last - 1, 1).getValues();
    var checked = 0, ok = 0, broken = [], noUrl = 0, samples = [];
    for (var i = col.length - 1; i >= 0 && checked < CAP; i--) { // newest first
      var url = String(col[i][0] || '').trim();
      if (!url) { noUrl++; continue; }
      var id = idFromUrl(url);
      checked++;
      if (!id) { broken.push({ row: i + 2, why: 'no id in url', url: url.slice(0, 60) }); continue; }
      try {
        var f = DriveApp.getFileById(id);
        var parent = f.getParents().hasNext() ? f.getParents().next().getName() : '(no parent)';
        ok++;
        if (samples.length < 3) samples.push({ row: i + 2, name: f.getName(), parent: parent });
      } catch (e) {
        broken.push({ row: i + 2, id: id, why: 'getFileById failed: ' + e.message });
      }
    }
    report.push({ module: s.module, checked: checked, resolved: ok, broken: broken, rowsWithNoUrl: noUrl, samples: samples });
  });
  return { note: 'read-only link check; broken[] should be empty', modules: report };
}

/** Read-only: resolve the 'PM QMS' folder(s) at Drive root, with IDs. */
function findPmQmsFolders_() {
  var out = [], it = DriveApp.getRootFolder().getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (/^PM QMS$/i.test(f.getName())) out.push({ name: f.getName(), id: f.getId() });
  }
  return out;
}

/**
 * migrateMediaIntoQmsData — move the root-level "Media" folder (photos/videos, already
 * structured as Media/<module>/<yyyy-MM>) inside <project>/QMS Data. Idempotent.
 * Moving the folder preserves every descendant file ID, so links keep working.
 * @param {boolean} apply pass true to move; omit for dry run.
 */
function migrateMediaIntoQmsData(apply) {
  var qmsData = getQmsDataFolder_();

  // Already nested? (Media directly under QMS Data)
  var inside = qmsData.getFoldersByName('Media');
  if (inside.hasNext()) {
    return { dryRun: !apply, action: 'none', reason: 'Media already under QMS Data', mediaId: inside.next().getId() };
  }

  // Find a Media at the spreadsheet parent or at root.
  var ss = getSpreadsheet();
  var ssParents = DriveApp.getFileById(ss.getId()).getParents();
  var candidates = [];
  if (ssParents.hasNext()) { var p = ssParents.next(); var i1 = p.getFoldersByName('Media'); while (i1.hasNext()) candidates.push(i1.next()); }
  var i2 = DriveApp.getRootFolder().getFoldersByName('Media');
  while (i2.hasNext()) { var f = i2.next(); if (candidates.indexOf(f) === -1) candidates.push(f); }

  if (!candidates.length) return { dryRun: !apply, action: 'none', reason: 'no external Media folder found' };
  var media = candidates[0];

  if (!apply) return { dryRun: true, action: 'would move', folder: 'Media', into: 'QMS Data', mediaId: media.getId() };
  media.moveTo(qmsData);
  return { dryRun: false, action: 'moved', folder: 'Media', into: 'QMS Data', mediaId: media.getId() };
}

/** Read-only: locate the Media folder (photos/videos) and its parent. */
function describeMediaLocation_() {
  var ss = getSpreadsheet();
  var ssParents = DriveApp.getFileById(ss.getId()).getParents();
  var ssParent = ssParents.hasNext() ? ssParents.next() : null;
  var out = { spreadsheetParent: ssParent ? ssParent.getName() : '(none)', mediaFolders: [] };
  // Media is created under the spreadsheet's parent; also scan root in case it drifted.
  function scan(where, label) {
    if (!where) return;
    var it = where.getFoldersByName('Media');
    while (it.hasNext()) {
      var m = it.next(), subs = [], si = m.getFolders();
      while (si.hasNext()) {
        var s = si.next(), months = [], mi = s.getFolders();
        while (mi.hasNext()) { var mm = mi.next(); var n = 0, f = mm.getFiles(); while (f.hasNext()) { f.next(); n++; } months.push(mm.getName() + ' (' + n + ')'); }
        subs.push({ module: s.getName(), months: months });
      }
      out.mediaFolders.push({ foundUnder: label, id: m.getId(), tree: subs });
    }
  }
  scan(ssParent, 'spreadsheet parent (' + (ssParent ? ssParent.getName() : '?') + ')');
  scan(DriveApp.getRootFolder(), 'My Drive root');
  return out;
}

/** Read-only: where does QMS Data actually live, and what's inside it? */
function describeQmsDataLocation_() {
  var proj = getProjectFolder_();
  var qd = getQmsDataFolder_();
  var kids = [], it = qd.getFolders();
  while (it.hasNext()) {
    var k = it.next(), sub = [], si = k.getFolders();
    while (si.hasNext()) { var s = si.next(); var n = 0, f = s.getFiles(); while (f.hasNext()) { f.next(); n++; } sub.push(s.getName() + ' (' + n + ')'); }
    kids.push({ module: k.getName(), months: sub });
  }
  return { projectFolder: proj.getName(), projectFolderId: proj.getId(), qmsDataParent: proj.getName(), tree: kids };
}
