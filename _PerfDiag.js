// ============================================================
// _PerfDiag.js — where does form-open time actually go?
//
// Driven by `node e2e-diag.js perfinit`. Read-only.
//
// The complaint is "forms load slow". Measured from the browser, GRN's shell
// appears at ~3.7s but its supplier dropdown is not usable until ~12.1s — so
// most of the wait is the boot RPC, not the HTML. This times each read that
// getGRNFormInit performs so the expensive one is a number, not a guess.
// ============================================================

function _perfTime_(label, fn) {
  var t0 = new Date().getTime();
  var n = -1, err = '';
  try {
    var out = fn();
    n = (out && out.length != null) ? out.length : (out ? 1 : 0);
  } catch (e) { err = ' ERR:' + e.message; }
  return { label: label, ms: new Date().getTime() - t0, n: n, err: err };
}

function perfFormInit() {
  var L = [];

  // Each read exactly as getGRNFormInit / getIQCFormInit call it.
  L.push(_perfTime_('peekNextDocNumber(grn)', function () { return peekNextDocNumber('grn'); }));
  L.push(_perfTime_('getSuppliers',   function () { return getSuppliers(); }));
  L.push(_perfTime_('getMaterials',   function () { return getMaterials(); }));
  L.push(_perfTime_('getInspectors',  function () { return getInspectors(); }));
  L.push(_perfTime_('getOpenRMLocations', function () {
    return (typeof getOpenRMLocations === 'function') ? getOpenRMLocations() : [];
  }));

  // Whole-call baseline: catches anything the parts miss (spreadsheet open,
  // serialization) and is the number the browser actually waits on.
  var whole = _perfTime_('== getGRNFormInit (whole)', function () { return getGRNFormInit(); });

  // Second call in the SAME execution — shows how much a per-request memo
  // would save. If this is ~0, the reads are already cached per request.
  var again = _perfTime_('== getGRNFormInit (2nd, same exec)', function () { return getGRNFormInit(); });

  var out = ['PERF — getGRNFormInit breakdown', ''];
  var sum = 0;
  L.forEach(function (r) {
    sum += r.ms;
    out.push(_perfPad_(r.label, 34) + _perfPad_(String(r.ms) + 'ms', 9) +
             'n=' + r.n + r.err);
  });
  out.push('');
  out.push(_perfPad_('sum of parts', 34) + sum + 'ms');
  out.push(_perfPad_(whole.label, 34) + whole.ms + 'ms' + whole.err);
  out.push(_perfPad_(again.label, 34) + again.ms + 'ms' + again.err);
  out.push('');

  // IQC measured 90s to shell / 180s to usable — by far the worst. Time its
  // boot read too, if the form exposes one.
  if (typeof getIQCFormInit === 'function') {
    var iqc = _perfTime_('== getIQCFormInit (whole)', function () { return getIQCFormInit(); });
    out.push(_perfPad_(iqc.label, 34) + iqc.ms + 'ms' + iqc.err);
  }
  if (typeof getPendingGRNsForIQC === 'function') {
    var pg = _perfTime_('getPendingGRNsForIQC', function () { return getPendingGRNsForIQC(); });
    out.push(_perfPad_(pg.label, 34) + pg.ms + 'ms  n=' + pg.n + pg.err);
  }

  return out.join('\n');
}

function _perfPad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

// Sheet sizes — a read is slow because of how many rows it touches.
function perfSheets() {
  var ss = getSpreadsheet();
  var want = ['MASTERS_Materials', 'MASTERS_Suppliers', 'MASTERS_Parameters',
              'LOCATIONS', 'GRN_LOG', 'IQC_LOG', 'STOCK_LEDGER', 'DOC_COUNTERS'];
  var out = ['SHEET SIZES', ''];
  want.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.push(_perfPad_(name, 24) + '(missing)'); return; }
    out.push(_perfPad_(name, 24) +
      _perfPad_(sh.getLastRow() + ' rows', 12) + sh.getLastColumn() + ' cols');
  });
  return out.join('\n');
}

// Is the form-masters payload small enough for CacheService?
// _pmCachePut_ silently SKIPS anything >= 100KB, which would leave the cache
// permanently cold while looking correct in the source.
function perfCacheSize() {
  var m = _grnFormMasters_();
  var out = ['FORM-MASTERS PAYLOAD SIZE', ''];
  var total = 0;
  ['suppliers', 'materials', 'inspectors', 'locations'].forEach(function (k) {
    var s = JSON.stringify(m[k] || []).length;
    total += s;
    out.push(_perfPad_(k, 14) + _perfPad_(String((m[k] || []).length) + ' rows', 12) +
             s + ' bytes');
  });
  var wrapped = JSON.stringify({ fp: '1755000000000', data: m }).length;
  out.push('');
  out.push(_perfPad_('sum', 14) + total + ' bytes');
  out.push(_perfPad_('with wrapper', 14) + wrapped + ' bytes');
  out.push(_perfPad_('cache limit', 14) + '100000 bytes');
  out.push('');
  out.push(wrapped < 100000
    ? 'VERDICT: FITS — cache will store it.'
    : 'VERDICT: TOO BIG — _pmCachePut_ will silently skip; cache stays cold.');
  return out.join('\n');
}

// ── Image upload probe ────────────────────────────────────────────────
// uploadGRNImages() catches every failure and returns {success:false} with the
// message only in Logger, so the operator sees "unable to upload images" and we
// see nothing. This runs the SAME path with a 1x1 PNG and returns the real
// error, including which step threw.
function perfImgUpload() {
  var out = ['GRN IMAGE UPLOAD PROBE', ''];

  function step(label, fn) {
    try {
      var v = fn();
      out.push(_perfPad_(label, 30) + 'OK  ' + (v == null ? '' : String(v).slice(0, 90)));
      return v;
    } catch (e) {
      out.push(_perfPad_(label, 30) + 'THREW: ' + e.message);
      return null;
    }
  }

  var parent = step('getProjectFolder_()', function () {
    var f = getProjectFolder_();
    return f.getName() + '  id=' + f.getId();
  });
  var media = step('getQmsMediaFolder_(GRN)', function () {
    var f = getQmsMediaFolder_('GRN', new Date());
    return f.getName() + '  id=' + f.getId();
  });

  // 1x1 transparent PNG — smallest valid payload the real path would carry.
  var px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  step('Utilities.base64Decode', function () {
    return Utilities.base64Decode(px).length + ' bytes';
  });

  var created = step('createFile in media folder', function () {
    var f = getQmsMediaFolder_('GRN', new Date());
    var blob = Utilities.newBlob(Utilities.base64Decode(px), 'image/png',
                                 'PROBE_' + Date.now() + '.png');
    var file = f.createFile(blob);
    return file.getId();
  });

  step('setSharing ANYONE_WITH_LINK', function () {
    if (!created) throw new Error('skipped — createFile failed');
    var file = DriveApp.getFileById(created);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  });

  // The real function, end to end.
  var res = step('uploadGRNImages() itself', function () {
    var r = uploadGRNImages([{ base64: px, mime: 'image/png', kind: 'doc' }]);
    return 'success=' + r.success + (r.error ? '  error=' + r.error : '') +
           '  docUrls=' + (r.docUrls || []).length;
  });

  // Clean up both probe files so the folder does not fill with 1x1 pngs.
  step('cleanup probe files', function () {
    var n = 0;
    if (created) { try { DriveApp.getFileById(created).setTrashed(true); n++; } catch (e) {} }
    try {
      var f = getQmsMediaFolder_('GRN', new Date());
      var it = f.getFiles();
      while (it.hasNext()) {
        var fl = it.next();
        if (fl.getName().indexOf('PROBE_') === 0 ||
            /^GRN_DOC_1_\d+\.png$/.test(fl.getName())) { fl.setTrashed(true); n++; }
      }
    } catch (e) {}
    return n + ' trashed';
  });

  out.push('');
  out.push('Drive quota remaining: ' + (function () {
    try { return DriveApp.getStorageLimit() - DriveApp.getStorageUsed(); }
    catch (e) { return 'unreadable: ' + e.message; }
  })());
  return out.join('\n');
}
