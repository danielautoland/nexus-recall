import { probeDaemon, formatStatus } from "./helpers.js";
import { ADAPTERS } from "./registry.js";

interface StatusOptions {
  json?: boolean;
  quiet?: boolean;
}

interface StatusResult {
  daemon: { status: string; message: string };
  surfaces: Record<string, { status: string; message: string }>;
}

function printLine(message: string) {
  process.stdout.write(message + "\n");
}

export async function cmdStatus(options: StatusOptions): Promise<number> {
  let hasError = false;

  const statusResult: StatusResult = {
    daemon: { status: "unknown", message: "" },
    surfaces: {}
  };

  const daemonInfo = await probeDaemon();
  if (daemonInfo.ok) {
    statusResult.daemon = { status: "ok", message: daemonInfo.detail };
    if (!options.quiet && !options.json) {
      printLine(`${"daemon".padEnd(15)} ${formatStatus("ok")}: ${daemonInfo.detail}`);
    }
  } else {
    hasError = true;
    statusResult.daemon = { status: "error", message: daemonInfo.detail };
    if (!options.quiet && !options.json) {
      printLine(`${"daemon".padEnd(15)} ${formatStatus("error")}: ${daemonInfo.detail}`);
    }
  }

  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    try {
      const r = await adapter.doctor();

      statusResult.surfaces[name] = { status: r.status, message: r.message };

      if (!options.quiet && !options.json) {
        printLine(`${name.padEnd(15)} ${formatStatus(r.status)}: ${r.message}`);
      }

      if (r.status === "broken") {
        hasError = true;
      }
    } catch (err) {
      hasError = true;
      const errMsg = (err as Error).message;
      statusResult.surfaces[name] = { status: "error", message: errMsg };
      if (!options.quiet && !options.json) {
        printLine(`${name.padEnd(15)} ${formatStatus("error")}: failed to check: ${errMsg}`);
      }
    }
  }

  if (options.json && !options.quiet) {
    printLine(JSON.stringify(statusResult, null, 2));
  }

  return hasError ? 1 : 0;
}
