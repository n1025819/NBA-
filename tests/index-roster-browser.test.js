const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForTarget(port, pageUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = await response.json();
      const target = targets.find((item) => item.url === pageUrl);
      if (target) return target;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome DevTools target did not become ready");
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      let nextId = 0;
      const pending = new Map();
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        const finish = pending.get(message.id);
        if (finish) {
          pending.delete(message.id);
          finish(message);
        }
      });
      resolve({
        send(method, params = {}) {
          return new Promise((finish) => {
            const id = ++nextId;
            pending.set(id, finish);
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}

(async () => {
  assert.ok(fs.existsSync(chrome), "Chrome is required for the browser roster test");
  const port = await getFreePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nba-roster-test-"));
  const pageUrl = pathToFileURL(path.join(root, "index.html")).href;
  const browser = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      pageUrl,
    ],
    { stdio: "ignore" },
  );
  let cdp;

  try {
    const target = await waitForTarget(port, pageUrl);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const result = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        count: document.querySelectorAll(".participant-option").length,
        label: document.getElementById("participantCount")?.textContent || ""
      })`,
      returnByValue: true,
    });
    const roster = JSON.parse(result.result.result.value);
    assert.equal(roster.count, 24, "the participant selector must render every card photo");
    assert.equal(roster.label, "已選 24 / 24 人");
    console.log("PASS: browser renders 24 participant checkboxes");
  } finally {
    if (cdp) await cdp.send("Browser.close").catch(() => {});
    if (!browser.killed) browser.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    const resolvedProfile = path.resolve(profile);
    assert.ok(resolvedProfile.startsWith(tempRoot), "refusing to remove a non-temp profile");
    fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
