import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const script = resolve("scripts/autostart-windows.ps1");
// Windows PowerShell 5.1 reads a script without a BOM in the system code page, which garbles the Korean messages.
test("autostart script is UTF-8 with BOM like the launcher", () => {
  assert.deepEqual([...readFileSync(script).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(readFileSync(resolve("autostart.cmd"), "utf8"), /scripts\\autostart-windows\.ps1" %\*/);
});
// The script itself only exists for Windows; other platforms have no Startup folder or WScript.Shell to run it against.
test("autostart toggles one shortcut to start.cmd in the given Startup folder and nothing else", { skip: process.platform !== "win32" && "Windows only" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "yweb-autostart-")), link = join(dir, "YWeb server.lnk");
  const run = (mode: string) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", mode, "-StartupDir", dir, "-NoPause"], { encoding: "utf8" });
  // What the shortcut points at, read back through the same Windows component that Explorer uses.
  const target = () => execFileSync("powershell", ["-NoProfile", "-Command", `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${link}'); $s.TargetPath + '|' + $s.WorkingDirectory + '|' + $s.WindowStyle`], { encoding: "utf8" }).trim();
  try {
    if (!existsSync(resolve(".env"))) { // a fresh checkout: the script refuses until the first run is done
      assert.throws(() => run("on"));
      assert.equal(existsSync(link), false);
      return;
    }
    run("status");
    assert.equal(existsSync(link), false);
    run("toggle");
    assert.equal(existsSync(link), true);
    assert.equal(target().toLowerCase(), [resolve("start.cmd"), resolve("."), "7"].join("|").toLowerCase());
    run("on"); // again: still one shortcut
    run("toggle");
    assert.equal(existsSync(link), false);
    run("off"); // already off: fine
    assert.equal(existsSync(link), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
