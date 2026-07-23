import { spawn } from "child_process";
import type { ILockDiagnoser, LockHolder } from "@bluestep-systems/b6p-core";

/**
 * Our own internal budget for the probe. Kept comfortably under the core's
 * ~2s outer race (`SharedFilePersistence.diagnoseSafely`) so we abort the
 * PowerShell child ourselves and return cleanly before the core gives up.
 * @lastreviewed null
 */
const PROBE_TIMEOUT_MS = 1_500;

/**
 * The unit of work behind {@link WindowsRestartManagerLockDiagnoser.diagnose}.
 * Extracted so tests can inject a fake (success, throw, hang) without spawning
 * PowerShell. `signal` is aborted when the internal timeout fires.
 * @lastreviewed null
 */
export type LockProbe = (fsPath: string, signal: AbortSignal) => Promise<LockHolder[]>;

/**
 * Best-effort Windows lock diagnoser backed by the Windows Restart Manager
 * (`rstrtmgr.dll`). Given a file the core failed to `rename` over, it names the
 * user-mode processes holding an open handle on it (an editor, OneDrive/Dropbox,
 * a second `b6p`), so the thrown error can say e.g. `… — locked by Code.exe (1234)`.
 *
 * It P/Invokes the Restart Manager from a short bundled PowerShell script
 * (`RmStartSession` → `RmRegisterResources` → `RmGetList` → `RmEndSession`) and
 * parses the JSON it prints. No native addon, so it survives esbuild bundling
 * and the SEA binary unchanged.
 *
 * Contract (see core `ILockDiagnoser`): never throws, and returns `[]` on
 * non-Windows, on any internal error, on timeout, or when no user-mode process
 * holds the file. An empty result is expected and correct when only a kernel
 * filesystem minifilter (real-time AV / ransomware protection such as Sophos
 * CryptoGuard) is interfering — minifilters hold no user-mode handle, so the
 * Restart Manager legitimately sees nothing, and the core turns that empty list
 * into its minifilter hint.
 * @lastreviewed null
 */
export class WindowsRestartManagerLockDiagnoser implements ILockDiagnoser {
  private readonly probe: LockProbe;
  private readonly platform: NodeJS.Platform;

  /**
   * @param probe The lock-probe implementation (defaults to the real Restart
   *   Manager probe). Injectable so tests can supply a fake.
   * @param platform The current platform (defaults to `process.platform`).
   *   Injectable so the Windows and non-Windows branches are testable on any
   *   runner without mutating the `process.platform` global.
   */
  constructor(probe: LockProbe = runRestartManagerProbe, platform: NodeJS.Platform = process.platform) {
    this.probe = probe;
    this.platform = platform;
  }

  async diagnose(fsPath: string): Promise<LockHolder[]> {
    if (this.platform !== "win32") {
      return [];
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      return await this.probe(fsPath, controller.signal);
    } catch {
      // Never surface a diagnoser failure — the core is only annotating an
      // already-failing write, so degrade to "unknown holders" ([]).
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Spawns PowerShell, hands it {@link RM_PROBE_SCRIPT} via `-EncodedCommand`
 * (base64 UTF-16LE — no temp file, no shell-quoting of the script), and passes
 * the target path out-of-band in the `B6P_LOCK_TARGET` env var so nothing user-
 * controlled is interpolated into the script text. Resolves with the parsed
 * holders; rejects on spawn error, non-zero exit, or abort (all caught upstream).
 * @lastreviewed null
 */
function runRestartManagerProbe(fsPath: string, signal: AbortSignal): Promise<LockHolder[]> {
  return new Promise<LockHolder[]>((resolve, reject) => {
    const encoded = Buffer.from(RM_PROBE_SCRIPT, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      {
        signal,
        windowsHide: true,
        env: { ...process.env, B6P_LOCK_TARGET: fsPath },
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Restart Manager probe exited with code ${code ?? "null"}`));
        return;
      }
      resolve(parseHolders(out));
    });
  });
}

/**
 * Parses the probe's stdout (a JSON array of `{ name, pid }`) into
 * {@link LockHolder}s, dropping anything malformed. Returns `[]` for empty or
 * non-array output. Exported for unit testing.
 * @lastreviewed null
 */
export function parseHolders(raw: string): LockHolder[] {
  const text = raw.trim();
  if (!text) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const holders: LockHolder[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const name = rec.name;
      const pid = rec.pid;
      if (typeof name === "string" && name.length > 0 && typeof pid === "number" && Number.isFinite(pid)) {
        holders.push({ name, pid: pid });
      }
    }
  }
  return holders;
}

/**
 * PowerShell that P/Invokes the Windows Restart Manager for the file named in
 * `$env:B6P_LOCK_TARGET` and prints a JSON array of `{ name, pid }` for each
 * user-mode process holding it open. Prints `[]` (empty array) when nothing
 * holds it — which, for a write that still failed, is itself the fingerprint of
 * a kernel filesystem minifilter (see the class doc). Always exits 0 on a
 * handled failure so the Node side can distinguish "no holders" from "probe
 * broke" only by parse-ability, not by needing the exit code.
 * @lastreviewed null
 */
const RM_PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$target = $env:B6P_LOCK_TARGET
if ([string]::IsNullOrEmpty($target)) { Write-Output '[]'; exit 0 }

$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class B6PRm {
    [StructLayout(LayoutKind.Sequential)]
    public struct RM_UNIQUE_PROCESS {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    const int CCH_RM_MAX_APP_NAME = 255;
    const int CCH_RM_MAX_SVC_NAME = 63;

    public enum RM_APP_TYPE {
        RmUnknownApp = 0, RmMainWindow = 1, RmOtherWindow = 2,
        RmService = 3, RmExplorer = 4, RmConsole = 5, RmCritical = 1000
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
        public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
        public string strServiceShortName;
        public RM_APP_TYPE ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
        uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo,
        [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint pSessionHandle);

    public static RM_PROCESS_INFO[] GetLockers(string path) {
        uint handle;
        StringBuilder key = new StringBuilder(64);
        int rv = RmStartSession(out handle, 0, key);
        if (rv != 0) return new RM_PROCESS_INFO[0];
        try {
            string[] resources = new string[] { path };
            rv = RmRegisterResources(handle, 1, resources, 0, null, 0, null);
            if (rv != 0) return new RM_PROCESS_INFO[0];

            uint needed = 0;
            uint count = 0;
            uint reasons = 0;
            // First pass with a null buffer asks how many entries exist.
            rv = RmGetList(handle, out needed, ref count, null, ref reasons);
            if (needed == 0) return new RM_PROCESS_INFO[0];

            RM_PROCESS_INFO[] info = new RM_PROCESS_INFO[needed];
            count = needed;
            rv = RmGetList(handle, out needed, ref count, info, ref reasons);
            if (rv != 0) return new RM_PROCESS_INFO[0];

            if (count < info.Length) {
                RM_PROCESS_INFO[] trimmed = new RM_PROCESS_INFO[count];
                Array.Copy(info, trimmed, (int)count);
                return trimmed;
            }
            return info;
        } finally {
            RmEndSession(handle);
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp | Out-Null
    $lockers = [B6PRm]::GetLockers($target)
    $results = @()
    foreach ($l in $lockers) {
        $procId = [int]$l.Process.dwProcessId
        $name = $null
        try {
            $p = Get-Process -Id $procId -ErrorAction Stop
            if ($p.Path) { $name = Split-Path -Leaf $p.Path }
            elseif ($p.ProcessName) { $name = $p.ProcessName + '.exe' }
        } catch {}
        if ([string]::IsNullOrEmpty($name)) { $name = $l.strAppName }
        if ([string]::IsNullOrEmpty($name)) { $name = 'unknown' }
        $results += [pscustomobject]@{ name = $name; pid = $procId }
    }
    $json = ($results | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join ','
    Write-Output ('[' + $json + ']')
} catch {
    Write-Output '[]'
}
exit 0
`;
