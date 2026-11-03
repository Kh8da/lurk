'use strict';
// Tells when a fullscreen game (or any fullscreen app) is in front, using the
// same Windows check that silences notifications during games. One hidden
// PowerShell process reports the state every 10 seconds.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const SCRIPT = `
Add-Type -Namespace Lurk -Name Quns -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'
while ($true) {
  $s = 0
  [void][Lurk.Quns]::SHQueryUserNotificationState([ref]$s)
  [Console]::Out.WriteLine($s)
  [Console]::Out.Flush()
  Start-Sleep -Seconds 10
}`;

// QUNS_BUSY (a fullscreen app) and QUNS_RUNNING_D3D_FULL_SCREEN (a game).
const FULLSCREEN = new Set([2, 3]);

class Gaming extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.proc = null;
  }

  start() {
    if (this.proc || process.platform !== 'win32') return;
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let buf = '';
    this.proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        const state = parseInt(line, 10);
        if (Number.isNaN(state)) continue;
        this.set(FULLSCREEN.has(state));
      }
    });
    this.proc.on('exit', () => {
      this.proc = null;
      this.set(false);
    });
  }

  stop() {
    if (this.proc) this.proc.kill();
    this.proc = null;
    this.set(false);
  }

  set(active) {
    if (this.active === active) return;
    this.active = active;
    this.emit('change', active);
  }
}

module.exports = { Gaming };
