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
function getProjectFolder_() {
  var props = PropertiesService.getScriptProperties();
  var pinned = props.getProperty(QMS_DATA_PARENT_PROP_);
  if (pinned) {
    try { return DriveApp.getFolderById(pinned); }
    catch (e) { /* stale id — fall through and re-resolve */ }
  }
  var byName = DriveApp.getRootFolder().getFoldersByName('PM QMS');
  if (byName.hasNext()) {
    var f = byName.next();
    props.setProperty(QMS_DATA_PARENT_PROP_, f.getId()); // cache for next time
    return f;
  }
  var ss = getSpreadsheet();
  var parents = DriveApp.getFileById(ss.getId()).getParents();
  if (!parents.hasNext()) throw new Error('Cannot find a parent folder for QMS Data.');
  return parents.next();
}

/** Pin the QMS Data parent explicitly (e.g. after moving the folder). */
function setQmsDataParent(folderId) {
  DriveApp.getFolderById(folderId); // throws if invalid
  PropertiesService.getScriptProperties().setProperty(QMS_DATA_PARENT_PROP_, folderId);
  return { ok: true, parentId: folderId };
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

/** Read-only: resolve the 'PM QMS' folder(s) at Drive root, with IDs. */
function findPmQmsFolders_() {
  var out = [], it = DriveApp.getRootFolder().getFolders();
  while (it.hasNext()) {
    var f = it.next();
    if (/^PM QMS$/i.test(f.getName())) out.push({ name: f.getName(), id: f.getId() });
  }
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
