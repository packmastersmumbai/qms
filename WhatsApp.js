// ============================================================
// WhatsApp.gs — wa.me pre-filled message builder
// No API, no cost — opens WhatsApp with pre-filled text
// ============================================================

// Resolve the deployed web-app URL dynamically so this file never needs
// a hardcoded deployment ID. Matches the pattern used in Code.js / DocView.js.
// Falls back to a no-op string rather than throwing if called outside a
// deployed-web-app context (e.g. from a spreadsheet sidebar).
function getQmsAppUrl_() {
  try {
    var url = ScriptApp.getService().getUrl();
    if (url) return url;
  } catch (e) {}
  return '';
}

// Public-facing base URL for user-scannable / shareable links (QR codes, emails,
// WhatsApp). Points at GitHub Pages, NOT the raw script.google.com URL — the
// Pages index.html forwards ?doc=/?page= query params into the GAS iframe.
// Use this for anything a person clicks/scans; use getQmsAppUrl_ (GAS) only for
// in-app google.script.run navigation.
var QMS_PUBLIC_BASE_ = 'https://packmastersmumbai.github.io/qms';
function getPublicUrl_() { return QMS_PUBLIC_BASE_; }

function buildWhatsAppURL(record) {
  var msg = buildMessage_(record);
  return 'https://wa.me/?text=' + encodeURIComponent(msg);
}

function buildMessage_(r) {
  var lines = ['[Pack Masters QMS]', ''];

  if (r.type === 'GRN') {
    lines.push('📥 GRN — Goods Receipt Note');
    lines.push('Doc No   : ' + r.docNo);
    lines.push('Date     : ' + r.date);
    lines.push('Supplier : ' + r.supplier);
    lines.push('Material : ' + r.material);
    lines.push('Batch    : ' + (r.batch || '—'));
    lines.push('Qty Ord  : ' + (r.qtyOrdered  || '—'));
    lines.push('Qty Rcvd : ' + (r.qtyReceived || '—'));
    lines.push('IQC Status: ' + statusEmoji_(r.status) + ' ' + (r.status || 'PENDING'));
    lines.push('');
    lines.push('Next Step — Open IQC: ' + getPublicUrl_());
  }

  else if (r.type === 'IQC') {
    lines.push('🔍 IQC — Incoming Inspection');
    lines.push('Doc No   : ' + r.docNo);
    lines.push('GRN Ref  : ' + (r.grnNo || '—'));
    lines.push('Date     : ' + r.date);
    lines.push('Supplier : ' + r.supplier);
    lines.push('Material : ' + r.material);
    lines.push('Batch    : ' + (r.batch || '—'));
    lines.push('Inspector: ' + (r.inspector || '—'));
    lines.push('Result   : ' + statusEmoji_(r.disposition) + ' ' + (r.disposition || 'PENDING'));
    if (r.ncrRef) lines.push('NCR Ref  : ' + r.ncrRef);
    lines.push('');
    lines.push('Next Step — Open OQC: ' + getPublicUrl_());
  }

  else if (r.type === 'OQC') {
    lines.push('📤 OQC — Outgoing Inspection');
    lines.push('Doc No   : ' + r.docNo);
    lines.push('Date     : ' + r.date);
    lines.push('Customer : ' + r.customer);
    lines.push('Material : ' + r.material);
    lines.push('Batch/PO : ' + (r.batchPO || '—'));
    lines.push('Inspector: ' + (r.inspector || '—'));
    lines.push('Decision : ' + statusEmoji_(r.releaseDecision) + ' ' + (r.releaseDecision || 'PENDING'));
  }

  else if (r.type === 'IPQC') {
    // WhatsApp supports *bold* and _italic_ formatting markdown.
    lines.push('*IPQC Round Report* ⚙️');
    lines.push('');
    lines.push('📦  *Product:*  ' + (r.product || '—'));
    lines.push('🔖  *Batch:*  ' + (r.batch || '—'));
    if (r.inspector) lines.push('👤  *Inspector:*  ' + r.inspector);
    if (r.sessionId) lines.push('🆔  *Session:*  ' + r.sessionId);
    lines.push('');

    // Per-round breakdown — round no, time, avg weight, P/F counts
    if (r.rounds && r.rounds.length) {
      lines.push('*Rounds (' + r.rounds.length + ')*');
      r.rounds.forEach(function(rd) {
        var parts = ['Rnd ' + rd.roundNo];
        if (rd.elapsedHms) parts.push('⏱️ ' + rd.elapsedHms);
        if (rd.avgWeight)  parts.push('⚖️ ' + rd.avgWeight);
        parts.push('✅ ' + (rd.pass || 0));
        if (rd.fail) parts.push('❌ ' + rd.fail);
        if (rd.leak) parts.push('💧 ' + rd.leak);
        lines.push('• ' + parts.join('   '));
      });
      lines.push('');
    }

    // Totals
    if (r.summary) {
      lines.push('*Totals*');
      lines.push('✅ Pass: ' + (r.summary.pass || 0) +
                 '    ❌ Fail: ' + (r.summary.fail || 0) +
                 '    ➖ NA: ' + (r.summary.na || 0));
      lines.push('');
    }

    // Fail detail
    if (r.fails && r.fails.length) {
      lines.push('*Fails detected*');
      r.fails.slice(0, 10).forEach(function(f) {
        var line = '❌  R' + f.roundNo + ' — ' + f.paramName;
        if (f.actualValue) line += ' = ' + f.actualValue;
        lines.push(line);
        if (f.remark) lines.push('     _' + f.remark + '_');
      });
      if (r.fails.length > 10) lines.push('   …+' + (r.fails.length - 10) + ' more');
      lines.push('');
    }

    // IPQC used to `return` here to skip the "Raised by" footer. It now falls
    // through like every other branch, because the shared footer below is what
    // attaches the PDF link — an early return would leave IPQC (the one form
    // that already HAD sharing) as the only one without its document.
    // recordUrl is emitted by the shared footer, so only the no-link fallback
    // stays here.
    if (!r.recordUrl) lines.push('Open QMS: ' + getPublicUrl_());
  }

  // ── Generic fallback ────────────────────────────────────────────────
  // Every record type that has no bespoke branch above still produces a
  // useful message instead of a bare header. Without this, adding Share to
  // Dispatch / Gatepass / PO / Rework / CustomerReturn would post an empty
  // card. Fields are printed only when present, so one branch serves all.
  else {
    lines.push('📋 ' + (r.title || r.type || 'QMS Record'));
    [['Doc No   ', r.docNo],
     ['Date     ', r.date],
     ['Supplier ', r.supplier],
     ['Customer ', r.customer],
     ['Material ', r.material],
     ['Product  ', r.product],
     ['Batch    ', r.batch],
     ['Qty      ', r.qty],
     ['Vehicle  ', r.vehicleNo],
     ['Operator ', r.operator],
     ['Inspector', r.inspector]
    ].forEach(function (p) { if (p[1]) lines.push(p[0] + ': ' + p[1]); });
    var st = r.status || r.disposition || r.releaseDecision;
    if (st) lines.push('Status   : ' + statusEmoji_(st) + ' ' + st);
  }

  // ── Shared footer: the document itself ──────────────────────────────
  // wa.me carries TEXT ONLY — it cannot attach a file — so the PDF travels as
  // a link. Previously no branch emitted pdfUrl at all, so a shared message
  // never referenced the document it described.
  if (r.pdfUrl) {
    lines.push('');
    lines.push('📎 PDF: ' + r.pdfUrl);
  }
  if (r.recordUrl) {
    lines.push('🔗 Open record: ' + r.recordUrl);
  }

  lines.push('');
  lines.push('Raised by: QA Dept, Pack Masters');
  return lines.join('\n');
}

function statusEmoji_(status) {
  if (!status) return '⏳';
  var s = status.toUpperCase();
  if (s === 'ACCEPTED' || s === 'RELEASED')        return '✅';
  if (s === 'REJECTED')                             return '❌';
  if (s === 'HOLD')                                 return '⏸️';
  if (s === 'ACCEPTED WITH DEVIATION')              return '⚠️';
  if (s === 'PENDING')                              return '⏳';
  return '📋';
}

// Called from HTML forms to get the WA URL for a just-saved record
function getWhatsAppURLForRecord(record) {
  return buildWhatsAppURL(record);
}
