const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const port = Number(process.env.SYNC_PORT || 8787);
const repoRoot = process.cwd();
const dataDir = path.join(repoRoot, "data");
const outputFile = path.join(dataDir, "操作紀錄.xlsx");

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function runGit(args) {
  execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
}

function syncToGitHub(fileName) {
  try {
    runGit(["add", fileName]);
    try {
      runGit(["diff", "--cached", "--quiet"]);
      return { pushed: false, message: "沒有新變更" };
    } catch (_) {
      // 有 staged changes，繼續 commit/push
    }
    try {
      runGit([
        "-c",
        "user.name=Sync Bot",
        "-c",
        "user.email=sync-bot@local",
        "commit",
        "-m",
        "Update operation log",
      ]);
    } catch (error) {
      const stderr = String(error.stderr || error.message || "");
      if (!stderr.includes("nothing to commit")) {
        throw error;
      }
      return { pushed: false, message: "沒有新變更" };
    }
    try {
      runGit(["push"]);
      return { pushed: true, message: "已推送到 GitHub" };
    } catch (error) {
      return { pushed: false, message: `已寫入本機，但 push 失敗：${String(error.stderr || error.message || "").trim()}` };
    }
  } catch (error) {
    return { pushed: false, message: `Git 同步失敗：${String(error.stderr || error.message || "").trim()}` };
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Page");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, port }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/sync") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
    return;
  }

  const chunks = [];
  let received = 0;
  const maxBytes = 25 * 1024 * 1024;

  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxBytes) {
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "File too large" }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    try {
      ensureDataDir();
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(outputFile, buffer);
      const gitResult = syncToGitHub(path.relative(repoRoot, outputFile));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        fileName: path.relative(repoRoot, outputFile),
        savedAt: new Date().toISOString(),
        ...gitResult,
      }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Sync server running at http://127.0.0.1:${port}`);
  console.log(`Saving to ${path.relative(repoRoot, outputFile)}`);
});
