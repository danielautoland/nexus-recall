#!/usr/bin/env node
// Thin launcher for the unscoped `bastra-recall` package.
//
// Re-exports the daemon's `bastra` CLI so `npx bastra-recall install all` and
// `npm i -g bastra-recall` work and the brand name is claimed on npm. The real
// CLI lives in @bastra-recall/daemon; importing its entry module runs it against
// process.argv (cli.ts calls main() unconditionally, no main-module guard), so
// argv and exit codes pass through untouched.
import "@bastra-recall/daemon/dist/cli.js";
