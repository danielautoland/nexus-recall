export interface InstallOpts {
  dryRun: boolean;
  vaultPath: string | null;
  // --yes: replace a foreign statusLine instead of keeping it.
  force?: boolean;
  // Stop hook can emit multi-line save-eval suggestions, so it is opt-in.
  withStopHook?: boolean;
}

export interface InstallResult {
  status: "installed" | "already-installed" | "would-install" | "error" | "not-implemented";
  message: string;
  configPath?: string;
  backupPath?: string;
}

export interface UninstallResult {
  status: "removed" | "not-present" | "would-remove" | "error" | "not-implemented";
  message: string;
  configPath?: string;
  backupPath?: string;
}

export interface DoctorResult {
  status: "ok" | "missing" | "broken" | "not-implemented";
  message: string;
  details?: Record<string, string>;
}

export interface Adapter {
  surface: string;
  description: string;
  configPath: string;
  install(opts: InstallOpts): Promise<InstallResult>;
  uninstall(opts: { dryRun: boolean }): Promise<UninstallResult>;
  doctor(): Promise<DoctorResult>;
}

export interface ParsedArgs {
  command: string | null;
  surface: string | null;
  dryRun: boolean;
  vaultPath: string | null;
  showHelp: boolean;
  showVersion: boolean;
  yes: boolean;
  fix: boolean;
  withStopHook: boolean;
  // `update --staged`: swap files only (npm/brew + re-register), no daemon
  // kickstart. The new code goes live on the next daemon boot. Used by the
  // SessionStart auto-update path so a running session is never disrupted.
  staged: boolean;
  // All positional tokens, in order — for sub-commands like
  // `config set update.mode auto` that need more than command+surface.
  positional: string[];
}
