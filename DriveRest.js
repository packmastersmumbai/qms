// ============================================================
// DriveRest.js — Drive operations that work under the drive.file scope.
//
// WHY THIS EXISTS (measured 2026-08-12, ?diag=driverest):
// Apps Script's DriveApp wrapper demands the RESTRICTED auth/drive scope for
// almost everything — even DriveApp.createFolder, and even to re-open a file the
// script itself just made. auth/drive grants an app the user's ENTIRE Drive, so
// Google gates it behind OAuth app verification, which this project cannot pass
// on any useful timescale.
//
// The Drive REST API honours auth/drive.file properly: an app may create files
// and folders, and may read/modify anything it created. That is exactly the
// access this project needs — it only ever touches its own PDFs and images.
//
// Proven end to end before this file was written:
//   REST create folder : HTTP 200
//   REST upload file   : HTTP 200
//   REST share anyone  : HTTP 200
//   REST delete        : HTTP 204
//   DriveApp.getFileById(own file): FAIL — the wrapper still refuses
//
// So: never call DriveApp here. Every function below goes over UrlFetchApp with
// the script's own OAuth token, which already carries drive.file.
// ============================================================

var DRIVE_API_     = 'https://www.googleapis.com/drive/v3/files';
var DRIVE_UPLOAD_  = 'https://www.googleapis.com/upload/drive/v3/files';
var DRIVE_FOLDER_MIME_ = 'application/vnd.google-apps.folder';

function _drvToken_() { return ScriptApp.getOAuthToken(); }

function _drvFetch_(url, opts) {
  var o = opts || {};
  o.muteHttpExceptions = true;
  o.headers = o.headers || {};
  o.headers.Authorization = 'Bearer ' + _drvToken_();
  var r = UrlFetchApp.fetch(url, o);
  var code = r.getResponseCode();
  var text = r.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Drive REST ' + code + ': ' + text.slice(0, 200));
  }
  // 204 No Content (delete) has no body to parse.
  return text ? JSON.parse(text) : {};
}

/** Find a folder by name under a parent the app owns. Returns id or ''. */
function drvFindFolder(name, parentId) {
  var q = "mimeType='" + DRIVE_FOLDER_MIME_ + "'" +
          " and name='" + String(name).replace(/'/g, "\\'") + "'" +
          " and trashed=false" +
          (parentId ? " and '" + parentId + "' in parents" : '');
  var res = _drvFetch_(DRIVE_API_ + '?q=' + encodeURIComponent(q) +
                       '&fields=files(id,name)&pageSize=10', { method: 'get' });
  return (res.files && res.files.length) ? res.files[0].id : '';
}

/** Create a folder and return its id. */
function drvCreateFolder(name, parentId) {
  var body = { name: String(name), mimeType: DRIVE_FOLDER_MIME_ };
  if (parentId) body.parents = [parentId];
  var res = _drvFetch_(DRIVE_API_ + '?fields=id', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body)
  });
  return res.id;
}

/** Idempotent: reuse the folder if it already exists, else create it. */
function drvGetOrCreateFolder(name, parentId) {
  var found = drvFindFolder(name, parentId);
  return found || drvCreateFolder(name, parentId);
}

/**
 * Upload a blob. Returns { id, webViewLink }.
 * Multipart so metadata (name, parent) and bytes go in one request — the
 * simple upload endpoint cannot set a parent.
 */
function drvUploadBlob(blob, name, parentId) {
  var boundary = 'pmqms' + new Date().getTime();
  var meta = { name: String(name) };
  if (parentId) meta.parents = [parentId];

  // Build the multipart body as raw BYTES, not a string: a string payload would
  // corrupt binary content (images, PDFs) via charset conversion.
  var head = Utilities.newBlob(
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + (blob.getContentType() || 'application/octet-stream') + '\r\n\r\n'
  ).getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var payload = head.concat(blob.getBytes()).concat(tail);

  var res = _drvFetch_(DRIVE_UPLOAD_ + '?uploadType=multipart&fields=id,webViewLink', {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: payload
  });
  return { id: res.id, webViewLink: res.webViewLink || drvViewUrl(res.id) };
}

/** Make a file readable by anyone with the link. */
function drvShareAnyone(fileId) {
  _drvFetch_(DRIVE_API_ + '/' + fileId + '/permissions', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return drvViewUrl(fileId);
}

/**
 * Delete a file the app created. Under drive.file this succeeds only for the
 * app's own files, which is the intent — used to clean up throwaway diagnostic
 * artefacts so they do not accumulate in real document folders.
 */
function drvDeleteFile(fileId) {
  try { _drvFetch_(DRIVE_API_ + '/' + fileId, { method: 'delete' }); return true; }
  catch (e) { return false; }
}

/** Canonical view URL — webViewLink is not always returned. */
function drvViewUrl(fileId) {
  return 'https://drive.google.com/file/d/' + fileId + '/view';
}

/** Fetch a file's bytes as a blob (only works for files the app owns). */
function drvGetBlob(fileId, name) {
  var url = DRIVE_API_ + '/' + fileId + '?alt=media';
  var r = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + _drvToken_() }
  });
  if (r.getResponseCode() !== 200) {
    throw new Error('Drive REST get blob ' + r.getResponseCode());
  }
  var b = r.getBlob();
  if (name) b.setName(name);
  return b;
}

/** Convert an HTML blob to PDF and store it. Returns { id, url }. */
function drvHtmlToPdf(html, fileName, parentId) {
  // getAs('application/pdf') on a Blob is a pure conversion — no Drive access —
  // so it is safe under drive.file. Only the STORE needs REST.
  var pdf = Utilities.newBlob(html, 'text/html', fileName + '.html')
                     .getAs('application/pdf');
  pdf.setName(fileName + '.pdf');
  var up = drvUploadBlob(pdf, fileName + '.pdf', parentId);
  drvShareAnyone(up.id);
  return { id: up.id, url: drvViewUrl(up.id) };
}

function drvTrash(fileId) {
  _drvFetch_(DRIVE_API_ + '/' + fileId, {
    method: 'patch', contentType: 'application/json',
    payload: JSON.stringify({ trashed: true })
  });
}

// ── Module-level helpers so every writer shares one Drive path ────────
// GRN, IQC, IPQC and OQC each had their own copy of "render template -> temp
// file -> getAs(pdf) -> folder.createFile -> setSharing". All four broke the
// moment the scope became drive.file, and only GRN was migrated, so IQC/IPQC/
// OQC silently stopped producing PDFs and images. One helper each, used by all.

/** Render an HTML string to a shared PDF under QMS Data/<module>/<yyyy-MM>. */
function drvStoreModulePdf(moduleName, docNo, html) {
  var safe = String(docNo).replace(/[^A-Za-z0-9_.\-]/g, '_');
  return drvHtmlToPdf(html, safe, qmsMonthFolderId_(moduleName, new Date())).url;
}

/** Store one image blob under QMS Data/Media/<module>/<yyyy-MM>, shared by link. */
function drvStoreModuleImage(moduleName, filename, blob) {
  var up = drvUploadBlob(blob, filename, qmsMediaFolderId_(moduleName, new Date()));
  return drvShareAnyone(up.id);
}

/** Pull the Drive file id out of any of the URL shapes we store or receive. */
function drvIdFromUrl(url) {
  var s = String(url || '');
  var m = s.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) ||
          s.match(/[?&]id=([A-Za-z0-9_-]{10,})/) ||
          s.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}

/**
 * Turn stored image URLs into data: URIs for PRINT.
 *
 * Images are stored as `https://drive.google.com/file/d/<id>/view`, which is an
 * HTML page, not an image — an <img src> pointing at it can never render, which
 * is why the print templates showed link text where photos should be. The
 * `uc?export=view` form is a redirect that needs a live browser session, so it
 * is no better inside Utilities.getAs('application/pdf'), which fetches nothing
 * at all. Embedding the bytes is the only form that survives the conversion.
 *
 * Fails soft per image: one unreadable photo must not cost the whole document.
 * Capped because each image inflates the PDF by ~4/3 of its byte size.
 */
function drvImagesAsDataUris(urls, max, maxBytes) {
  max = max || 6;
  maxBytes = maxBytes || 900000;          // ~900KB per image before we skip it
  var out = [];
  (urls || []).forEach(function (u) {
    if (out.length >= max) return;
    var id = drvIdFromUrl(u);
    if (!id) return;
    try {
      var blob = drvGetBlob(id, 'img');
      var bytes = blob.getBytes();
      if (!bytes.length || bytes.length > maxBytes) return;
      var ct = blob.getContentType() || 'image/jpeg';
      if (ct.indexOf('image/') !== 0) return;
      out.push({ src: 'data:' + ct + ';base64,' + Utilities.base64Encode(bytes), href: u });
    } catch (e) { /* skip this one, keep the rest */ }
  });
  return out;
}
