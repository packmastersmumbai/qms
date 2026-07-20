// ============================================================
// TelegramCommands.js — QMS bot: domain command map + digest + alerts
// Read-only. Reuses existing QMS functions (no re-querying):
//   getRecordsCounts() · getKPIDashboard() · getRecordsList() · traceBatch()
// Config via Script Properties: TelegramBotToken, TelegramChatID
// ============================================================

var _E = function (s) { return TelegramLib.esc(s); };

// Openable doc link: tappable in Telegram, opens DocView via ?doc=<docNo>.
// Falls back to bold text if the app URL isn't available.
function _docLink(docNo) {
  var no = String(docNo || '').trim();
  if (!no) return '';
  var base = (typeof getPublicUrl_ === 'function') ? getPublicUrl_() : '';
  if (!base) return '<b>' + _E(no) + '</b>';
  return '<a href="' + base + '?doc=' + encodeURIComponent(no) + '">' + _E(no) + '</a>';
}

// ── Command map (consumed by TelegramLib.route) ──────────────
var TELEGRAM_COMMANDS = {
  '/help': function () {
    return '🤖 <b>PackMasters QMS Bot</b>\n' +
      '/status — pending counts per stage\n' +
      '/kpi — quality KPIs (FPY, NCR, OTD…)\n' +
      '/pending &lt;type&gt; — list pending (grn/iqc/oqc/ipqc/ncr/cr)\n' +
      '/rejected — rejected/on-hold records today\n' +
      '/trace &lt;docNo&gt; — trace a document\n' +
      '/id — this chat\'s ID  ·  /ping — health';
  },
  '/ping': function () { return '✅ QMS bot online — ' + new Date().toString(); },
  '/id': function (arg, chatId) {
    return 'Chat ID: <code>' + chatId + '</code>\nSet as <b>TelegramChatID</b> in Script Properties.';
  },

  '/status': function () {
    var c = getRecordsCounts();
    return '📋 <b>QMS — Pending</b>\n' +
      'GRN ' + c.grn + ' · IQC ' + c.iqc + ' · OQC ' + c.oqc + '\n' +
      'IPQC ' + c.ipqc + ' · Prod ' + c.production + ' · Dispatch ' + c.dispatch + '\n' +
      'NCR ' + c.ncr + ' · Cust.Return ' + c.cr + ' · Gatepass ' + c.gp;
  },

  '/kpi': function () {
    var k = getKPIDashboard({ preset: 'THIS_MONTH' });
    var t = k.tiles || {};
    function pct(v) { return v == null ? '—' : (Math.round(v * 10) / 10) + '%'; }
    var lines = ['📊 <b>QMS KPIs — this month</b>'];
    if (t.fpy) lines.push('FPY: <b>' + pct(t.fpy.value) + '</b> (' + (t.fpy.status || '') + ')');
    if (t.ncr) lines.push('NCR: <b>' + t.ncr.total + '</b> total · ' + t.ncr.open + ' open');
    if (t.supplierDefect) lines.push('Supplier defect: <b>' + pct(t.supplierDefect.overall) + '</b>');
    if (t.otd) lines.push('OTD: <b>' + pct(t.otd.value) + '</b>');
    if (t.custReturn) lines.push('Cust. returns: <b>' + (t.custReturn.total != null ? t.custReturn.total : '—') + '</b>');
    return lines.join('\n');
  },

  '/pending': function (arg) {
    var map = { grn: 'GRN', iqc: 'IQC', oqc: 'OQC', ipqc: 'IPQC', ncr: 'NCR',
                cr: 'CustomerReturn', gp: 'Gatepass', gatepass: 'Gatepass', production: 'Production' };
    var type = map[String(arg || '').toLowerCase().trim()];
    if (!type) return 'Usage: /pending &lt;grn|iqc|oqc|ipqc|ncr|cr&gt;';
    var rows = (getRecordsList(type, {}) || []).filter(function (r) {
      return /pending|open|hold|issued/i.test(String(r.status));
    });
    if (!rows.length) return 'No pending ' + type + '.';
    var lines = rows.slice(0, 20).map(function (r) {
      return '• ' + _docLink(r.docNo) + ' — ' + _E(r.name || '') + '  [' + _E(r.status) + ']';
    });
    if (rows.length > 20) lines.push('… +' + (rows.length - 20) + ' more');
    return '<b>Pending ' + type + ' (' + rows.length + ')</b>\n' + lines.join('\n');
  },

  '/rejected': function () {
    var types = ['IQC', 'OQC', 'IPQC', 'NCR', 'CustomerReturn'];
    var hits = [];
    types.forEach(function (t) {
      (getRecordsList(t, {}) || []).forEach(function (r) {
        if (/reject|fail|hold|out.?of.?spec/i.test(String(r.status)))
          hits.push('• ' + t + ' ' + _docLink(r.docNo) + ' — ' + _E(r.status));
      });
    });
    if (!hits.length) return '✅ No rejected / on-hold records.';
    return '🚫 <b>Rejected / on-hold (' + hits.length + ')</b>\n' + hits.slice(0, 25).join('\n');
  },

  '/trace': function (arg) {
    if (!arg) return 'Usage: /trace &lt;docNo&gt;';
    try {
      var t = traceBatch(String(arg).trim(), {});
      if (!t || !t.success) return 'No trace for ' + _E(arg) + '.';
      var comps = (t.upstream && t.upstream.components) || [];
      // Downstream is an object of doc lanes {oqc,gatepass,dispatch,fgJobs}; flatten to docNos.
      var dn = t.downstream || {};
      var downDocs = ['oqc', 'gatepass', 'dispatch', 'fgJobs'].reduce(function (acc, k) {
        (dn[k] || []).forEach(function (x) { if (x && x.docNo) acc.push(x.docNo); });
        return acc;
      }, []);
      function links(ids) {
        if (!ids.length) return '—';
        return ids.slice(0, 8).map(_docLink).join(', ') + (ids.length > 8 ? ' … +' + (ids.length - 8) : '');
      }
      // Upstream components are materials; their source docs (GRN/PO) live in .lots.
      var compNames = comps.map(function (c) { return _E(c.compCode || c.compDesc || '?'); });
      return '🔗 Trace ' + _docLink(String(arg).trim()) +
        '\n⬆️ Components (' + comps.length + '): ' + (compNames.length ? compNames.slice(0, 8).join(', ') + (compNames.length > 8 ? ' …' : '') : '—') +
        '\n⬇️ Downstream (' + downDocs.length + '): ' + links(downDocs);
    } catch (e) { return 'Trace error: ' + _E(e.message); }
  }
};

// ── Scheduled digest (wire to a daily trigger) ───────────────
function sendQmsDailyDigest() {
  var c = getRecordsCounts();
  var k = getKPIDashboard({ preset: 'THIS_MONTH' });
  var fpy = k.tiles && k.tiles.fpy ? k.tiles.fpy.value : null;
  var ncr = k.tiles && k.tiles.ncr ? k.tiles.ncr : { total: '—', open: '—' };
  var msg = '📊 <b>QMS Daily Digest</b> — ' + new Date().toLocaleDateString() + '\n' +
    'Pending: GRN ' + c.grn + ' · IQC ' + c.iqc + ' · OQC ' + c.oqc + ' · IPQC ' + c.ipqc + '\n' +
    'NCR ' + c.ncr + ' open · Cust.Return ' + c.cr + '\n' +
    'FPY ' + (fpy == null ? '—' : Math.round(fpy * 10) / 10 + '%') +
    ' · NCR total ' + ncr.total + ' (' + ncr.open + ' open)';
  return { sent: TelegramLib.send(msg) };
}

// ── Proactive alert (call from the event site) ───────────────
// kind: 'IQC_REJECT' | 'OQC_REJECT' | 'NCR' | 'IPQC_OOS' | 'CUST_RETURN'
function sendQmsAlert(kind, docNo, detail) {
  // Test-suppress hook: smoke tests set _QMS_SUPPRESS_NOTIFY so synthetic NCRs don't
  // fire real Telegram/UrlFetch calls (which also stall the headless smoke run).
  if (typeof _QMS_SUPPRESS_NOTIFY !== 'undefined' && _QMS_SUPPRESS_NOTIFY) return;
  var head = {
    IQC_REJECT:  '🚫 <b>IQC Rejected</b>',
    OQC_REJECT:  '🚫 <b>OQC Rejected</b>',
    NCR:         '⚠️ <b>NCR Raised</b>',
    IPQC_OOS:    '⚠️ <b>IPQC Out-of-Spec</b>',
    CUST_RETURN: '↩️ <b>Customer Return</b>'
  }[kind] || '🔔 <b>QMS Alert</b>';
  var msg = head + '\n' + (_docLink(docNo) || _E(docNo || '')) + (detail ? '\n' + _E(detail) : '');
  return TelegramLib.send(msg);
}

// ── Setup helpers ────────────────────────────────────────────
function enableQmsBot()  { return TelegramLib.enable(); }
function disableQmsBot() { return TelegramLib.disable(); }
function setQmsTelegramConfig(botToken, chatId) {
  PropertiesService.getScriptProperties().setProperties({
    TelegramBotToken: String(botToken || '').trim(),
    TelegramChatID:   String(chatId || '').trim()
  });
  return { success: true };
}
function testQmsTelegram() { return { sent: TelegramLib.send('✅ <b>QMS</b> Telegram connected.') }; }

// Install/replace a daily trigger that fires sendQmsDailyDigest at ~8am.
function installQmsDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendQmsDailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendQmsDailyDigest').timeBased().everyDays(1).atHour(8).create();
  return { success: true, digest: 'daily @ 08:00' };
}
