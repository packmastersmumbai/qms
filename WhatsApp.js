// ============================================================
// WhatsApp.gs — wa.me pre-filled message builder
// No API, no cost — opens WhatsApp with pre-filled text
// ============================================================

var QMS_APP_URL = 'https://script.google.com/macros/s/AKfycbz-Cs8wNXZiQgiVYh09cQcFVQd2DMDY-s8VHLhywnz0l8Me2_N5UWw03P7UHPCZLUkgKw/exec';

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
    lines.push('Next Step — Open IQC: ' + QMS_APP_URL);
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
    lines.push('Next Step — Open OQC: ' + QMS_APP_URL);
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
