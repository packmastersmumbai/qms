// Global runtime CONFIG flags.
// Sheet-based CONFIG (doc counters, KPI thresholds) lives in the CONFIG sheet — see DocNumber.js / Initialize.js.
// This object holds JS-level deployment toggles that gate exposure of test/admin/diagnostic functions
// callable via clasp run / API Executable.
//
// Set _TESTING_ENABLED = false for production deployments to lock out smoke/diag/backfill/test-helper functions.
var CONFIG = {
  _TESTING_ENABLED: true
};
