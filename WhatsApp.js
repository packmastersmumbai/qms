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
    lines.push('Next Step — Open IQC: ' + getQmsAppUrl_());
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
    lines.push('Next Step — Open OQC: ' + getQmsAppUrl_());
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

    // Deep link to the actual record
    if (r.recordUrl) {
      lines.push('🔗 Open record:');
      lines.push(r.recordUrl);
    } else {
      lines.push('Open QMS: ' + getQmsAppUrl_());
    }
    return lines.join('\n');  // skip the trailing "Raised by..." block below
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
