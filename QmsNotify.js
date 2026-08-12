// ============================================================
// QmsNotify.js — one place that turns a saved QMS record into
//   (a) a Telegram channel post, and
//   (b) a "next action" task pushed into TaskFlow DWM.
// Both consume the SAME record shape that WhatsApp.js buildMessage_ uses:
//   { type, docNo, supplier|customer, material, batch, status|disposition|
//     releaseDecision, inspector, operatorId, ncrRef, grnNo, ... }
// Config (Script Properties):
//   TelegramBotToken / TelegramChatID   (already set)
//   taskflow_hmac_secret                (shared with DWM — same value)
//   dwm_create_url                      (DWM /exec URL)
// ============================================================

// ── Per-stage → next-action definition ───────────────────────
// Given a record, returns the task to create in DWM, or null to skip.
// verdict is the normalized decision: ACCEPTED|REJECTED|HOLD|RELEASED|OOS|RECEIVED
function _nextActionFor_(r, verdict) {
  var doc = r.docNo || '';
  var mat = r.material || r.product || '';
  var who = r.inspector || r.operatorId || '';   // domain user first; session email is unreliable server-side

  // title, assignee(role/user), priority. ref = docNo (idempotent in DWM).
  switch (r.type) {
    case 'GRN':
      return { title: 'IQC inspection pending — ' + mat + ' (' + doc + ')',
               assignee: who, priority: 'high', status: 'todo' };
    case 'IQC':
      if (verdict === 'REJECTED')
        return { title: 'NCR triage — IQC reject ' + doc + (r.ncrRef ? ' / ' + r.ncrRef : ''),
                 assignee: who, priority: 'urgent', status: 'todo' };
      if (verdict === 'HOLD')
        return { title: 'Resolve IQC hold — ' + mat + ' (' + doc + ')',
                 assignee: who, priority: 'high', status: 'todo' };
      return { title: 'Material released to Production — ' + mat + ' (' + doc + ')',
               assignee: who, priority: 'medium', status: 'todo' };
    case 'IPQC':
      if (verdict === 'OOS')
        return { title: 'Disposition OOS batch — ' + mat + ' (' + doc + ')',
                 assignee: who, priority: 'urgent', status: 'todo' };
      return null;  // in-spec round = no task (noise)
    case 'OQC':
      if (verdict === 'RELEASED')
        return { title: 'Dispatch (FIFO) ready — ' + mat + ' (' + doc + ')',
                 assignee: who, priority: 'high', status: 'todo' };
      return { title: 'OQC hold disposition — ' + mat + ' (' + doc + ')',
               assignee: who, priority: 'urgent', status: 'todo' };
    case 'NCR':
      return { title: 'NCR triage — ' + (mat ? mat + ' ' : '') + '(' + doc + ')',
               assignee: who, priority: 'urgent', status: 'todo' };
    default:
      return null;
  }
}

// Normalize a record's decision into a single verdict token.
function _verdictOf_(r) {
  var s = String(r.status || r.disposition || r.releaseDecision || '').toUpperCase();
  if (/REJECT/.test(s)) return 'REJECTED';
  if (/HOLD/.test(s)) return 'HOLD';
  if (/RELEAS/.test(s)) return 'RELEASED';
  if (/OOS|OUT.?OF.?SPEC|FAIL/.test(s)) return 'OOS';
  if (/ACCEPT/.test(s)) return 'ACCEPTED';
  return 'RECEIVED';
}

// ── DWM signing — MUST match DWM _canonicalCreateString byte-for-byte ─────────
// canonical = sorted key=value (excl. sig, fmt, act) joined by '&';
// sig = base64WebSafe(HMAC_SHA256(canonical, secret)) with '=' stripped.
function _dwmSign_(params) {
  var secret = PropertiesService.getScriptProperties().getProperty('taskflow_hmac_secret');
  if (!secret) throw new Error('taskflow_hmac_secret not set in QMS');
  var keys = [];
  for (var k in params) {
    if (!params.hasOwnProperty(k)) continue;
    if (k === 'sig' || k === 'fmt' || k === 'act') continue;
    keys.push(k);
  }
  keys.sort();
  var parts = keys.map(function (k) {
    return k + '=' + String(params[k] == null ? '' : params[k]);
  });
  var canonical = parts.join('&');
  var sigBytes = Utilities.computeHmacSha256Signature(canonical, secret, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(sigBytes).replace(/=/g, '');
}

// Push a next-action task into DWM. Best-effort; never throws to the caller.
function pushDwmNextAction_(r) {
  try {
    if (typeof _QMS_SUPPRESS_NOTIFY !== 'undefined' && _QMS_SUPPRESS_NOTIFY) return;
    var base = PropertiesService.getScriptProperties().getProperty('dwm_create_url');
    if (!base) { Logger.log('dwm_create_url not set — skip'); return; }
    var verdict = _verdictOf_(r);
    var na = _nextActionFor_(r, verdict);
    if (!na) return;  // stage decided no task

    var params = {
      title:    na.title,
      assignee: na.assignee || '',
      creator:  '',   // blank → DWM uses its Integration bot as created_by
      priority: na.priority || 'medium',
      status:   na.status || 'todo',
      ref:      r.docNo || '',       // idempotency key in DWM
      shared:   '1',                 // team-visible (shows in DWM shared pool for everyone)
      // Description carries tappable source-record + PDF links (DWM linkifies URLs).
      desc:     'QMS ' + (r.type || '') + ' ' + (r.docNo || '') + ' — ' +
                getPublicUrl_() + '?doc=' + encodeURIComponent(r.docNo || '') +
                (r.pdfUrl ? '  PDF: ' + r.pdfUrl : ''),
      ts:       String(Math.floor(Date.now() / 1000))
    };
    params.sig = _dwmSign_(params);

    var qs = Object.keys(params).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'act=create&' + qs;

    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var summary = 'DWM push ' + (r.docNo || '') + ' → ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300);
    Logger.log(summary);
    return summary;
  } catch (e) {
    Logger.log('pushDwmNextAction_ skipped: ' + e.message);
    return 'pushDwmNextAction_ error: ' + e.message;
  }
}

// ── Telegram post — reuse WhatsApp buildMessage_ fields, render HTML ──────────
// Best-effort; never throws to the caller.
function notifyStage_(r) {
  try {
    var msg = _tgFromRecord_(r);
    if (!msg) return;

    // Attach the PDF itself when the record has one. Previously the message
    // carried only a link, which the recipient had to open in a browser and
    // authenticate against Drive to read — so the document never actually
    // reached the channel. sendDocument uploads the bytes.
    //
    // Falls back to the plain message on ANY failure (no pdfUrl, Drive
    // unreachable, file too large for Telegram's 50 MB cap), because a
    // notification without its attachment still beats no notification.
    if (r && r.pdfUrl) {
      try {
        var blob = _tgPdfBlob_(r.pdfUrl);
        if (blob && TelegramLib.sendDocument(blob, msg)) return;
      } catch (ePdf) {
        Logger.log('notifyStage_ pdf attach failed, sending text only: ' + ePdf.message);
      }
    }
    TelegramLib.send(msg);
  } catch (e) {
    Logger.log('notifyStage_ skipped: ' + e.message);
  }
}

// Resolve a Drive file URL to a blob Telegram can upload.
// Accepts the /d/<id>/ and ?id=<id> URL shapes DriveApp produces.
function _tgPdfBlob_(pdfUrl) {
  var m = String(pdfUrl || '').match(/[-\w]{25,}/);
  if (!m) return null;
  var file = DriveApp.getFileById(m[0]);
  var blob = file.getBlob();
  blob.setName(file.getName());
  return blob;
}

// Compact date for footer, e.g. "04-Jul 14:30". Accepts Date/string/blank.
function _tgWhen_(d) {
  var dt = d ? new Date(d) : new Date();
  if (isNaN(dt.getTime())) dt = new Date();
  return Utilities.formatDate(dt, 'GMT+0530', 'dd-MMM HH:mm');
}

// Short, context-aware next-action verb for the Telegram message (the full
// self-contained version stays in _nextActionFor_ for DWM task titles, which
// have no surrounding context). Telegram shows material/docNo above, so the
// verb alone is enough here.
function _naShort_(r, v) {
  switch (r.type) {
    case 'GRN':  return 'IQC inspection';
    case 'IQC':  return v === 'REJECTED' ? 'NCR triage' : v === 'HOLD' ? 'resolve IQC hold' : 'released to Production';
    case 'OQC':  return v === 'RELEASED' ? 'ready for Dispatch (FIFO)' : 'OQC hold disposition';
    case 'IPQC': return 'hold line · disposition OOS';
    case 'NCR':  return 'NCR triage';
    default:     return '';
  }
}

// Render a record as a compact 4-line, icon-labelled Telegram HTML message.
// L1: type · docNo · verdict   L2: party · material · batch · qty · refs
// L3: → next-action · 📎 PDF    L4: 👤 who · time
function _tgFromRecord_(r) {
  var E = TelegramLib.esc;
  var verdict = _verdictOf_(r);
  var vTok = { ACCEPTED:'✅ ACCEPTED', RELEASED:'✅ RELEASED', REJECTED:'🚫 REJECTED',
               HOLD:'⛔ HOLD', OOS:'⚠️ OOS', RECEIVED:'⏳ PENDING' }[verdict] || ('📋 ' + E(verdict));
  var icon = { GRN:'📥', IQC:'🔍', IPQC:'⚙️', OQC:'📤' }[r.type] || '🔔';
  var foot = '👤 ' + E(r.inspector || r.operatorId || '—') + ' · ' + _tgWhen_(r.date);

  // IPQC keeps its round report.
  if (r.type === 'IPQC' && r.rounds) return _tgIPQC_(r, icon, vTok, foot);

  var party = r.supplier || r.customer || '';
  var partyIcon = r.customer ? '🏢' : '🏭';
  var mat = r.material || r.product || '';

  // L1: headline with verdict
  var lines = [icon + ' <b>' + E(r.type || 'QMS') + '</b> · ' + _docLink(r.docNo) + ' · ' + vTok];

  // L2: all facts on one wrapped line
  var l2 = [];
  if (party) l2.push(partyIcon + ' ' + E(party));
  if (mat)   l2.push(E(mat));
  if (r.batch) l2.push('🏷 ' + E(r.batch));
  if (r.qtyReceived != null && r.qtyReceived !== '')
    l2.push('📦 ' + E((r.qtyOrdered != null && r.qtyOrdered !== '' ? r.qtyOrdered + '/' : '') + r.qtyReceived));
  if (r.grnNo) l2.push('↩ GRN ' + _docLink(r.grnNo));
  if (r.ncrRef) l2.push('⚠ NCR ' + _docLink(r.ncrRef));
  if (l2.length) lines.push(l2.join(' · '));

  // L3: next-action (verb only) + PDF inline
  var l3 = '→ ' + E(_naShort_(r, verdict));
  if (r.pdfUrl) l3 += ' · 📎 <a href="' + E(r.pdfUrl) + '">PDF</a>';
  lines.push(l3);

  lines.push(foot);
  return lines.join('\n');
}

// IPQC round report — compact: headline w/ verdict, facts line, rounds, totals+PDF, fails.
function _tgIPQC_(r, icon, vTok, foot) {
  var E = TelegramLib.esc;
  // L1: headline with verdict
  var lines = [icon + ' <b>IPQC</b> · ' + _docLink(r.sessionId || r.docNo) + ' · ' + vTok];
  // L2: product · batch
  var l2 = [];
  if (r.product) l2.push('📦 ' + E(r.product));
  if (r.batch) l2.push('🏷 ' + E(r.batch));
  if (l2.length) lines.push(l2.join(' · '));

  var rounds = r.rounds || [];
  if (rounds.length) {
    lines.push(rounds.map(function (rd) {
      var p = 'R' + (rd.roundNo != null ? rd.roundNo : '?') + ' ✅' + (rd.pass || 0);
      if (rd.fail) p += ' ❌' + rd.fail;
      if (rd.leak) p += ' 💧' + rd.leak;
      return p;
    }).join(' · '));
  }
  var s = r.summary || {};
  var totals = 'Σ ✅' + (s.pass || 0);
  if (s.fail) totals += ' ❌' + s.fail;
  if (s.na)   totals += ' ➖' + s.na;
  if (r.pdfUrl) totals += ' · 📎 <a href="' + E(r.pdfUrl) + '">PDF</a>';
  lines.push(totals);

  (r.fails || []).slice(0, 5).forEach(function (f) {
    var line = '⚠ R' + f.roundNo + ' ' + E(f.paramName || '');
    if (f.remark) line += ' — ' + E(f.remark);
    lines.push(line);
  });
  if ((r.fails || []).length > 5) lines.push('… +' + (r.fails.length - 5) + ' more');

  var na = { title: _naShort_(r, _verdictOf_(r)) };
  if (na.title) lines.push('→ ' + E(na.title));
  lines.push(foot);
  return lines.join('\n');
}

// ── One call for a save site to fire both channels ───────────
function qmsAnnounce_(record) {
  notifyStage_(record);
  pushDwmNextAction_(record);
}

// Client entry point: post an IPQC session report to Telegram (+ DWM if OOS).
// Called from IPQC_F.html's share action with the same record it builds for WhatsApp.
// Returns {ok:bool} so the form can toast success/failure.
function postIPQCToTelegram(record) {
  try {
    if (!record || record.type !== 'IPQC') return { ok: false, error: 'bad record' };
    notifyStage_(record);                 // rich round report to channel
    var v = _verdictOf_(record);
    if (v === 'OOS') pushDwmNextAction_(record);  // OOS → DWM disposition task
    return { ok: true };
  } catch (e) {
    Logger.log('postIPQCToTelegram: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// One-time config setter (run via editor/clasp; args stay out of any URL).
function setDwmIntegrationConfig(secret, dwmCreateUrl) {
  PropertiesService.getScriptProperties().setProperties({
    taskflow_hmac_secret: String(secret || '').trim(),
    dwm_create_url:       String(dwmCreateUrl || '').trim()
  });
  return { ok: true };
}

// ── Self-check (run manually): verifies signing is deterministic & non-empty ──
function _selfCheckDwmSign() {
  var p = { title: 'x', ref: 'PM/GRN/1', ts: '1700000000', status: 'todo' };
  var a = _dwmSign_(p), b = _dwmSign_(p);
  if (a !== b) throw new Error('sign not deterministic');
  if (!a) throw new Error('empty sig');
  Logger.log('sign ok: ' + a);
  return a;
}
