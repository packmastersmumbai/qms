// Intentionally empty on the GAS side.
// The real scanner is tools-deadscan.js.node and runs under Node, not Apps
// Script. An earlier version of this file was pushed with `require(...)` at the
// top, which threw "require is not defined" at PARSE time — that kills the
// whole project before any function runs, so every form and every diag failed.
// Kept as an empty stub so the server copy is harmless; .claspignore excludes
// the Node original.
