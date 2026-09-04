/** Daemon-owned telemetry wiring: event ledger plus the durable usage sidecar. */
import { Telemetry } from "./telemetry.js";
import { recordUsage } from "./usage-sidecar.js";

export function createDaemonTelemetry(vaultPath: string): Telemetry {
  return new Telemetry({
    onUsage: (events) => {
      void recordUsage(vaultPath, events);
    },
  });
}
