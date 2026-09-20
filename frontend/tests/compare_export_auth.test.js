const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MAIN_JS = path.join(__dirname, "..", "src", "main.js");

function loadMainSource() {
  return fs.readFileSync(MAIN_JS, "utf8");
}

/** Top-level functions in main.js close on a line that is only `}`. */
function extractTopLevelFunction(src, name) {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (start < 0) throw new Error(`function ${name} not found`);
  const out = [lines[start]];
  if (lines[start].trim().endsWith("}") && lines[start].includes("{")) {
    return out.join("\n");
  }
  for (let i = start + 1; i < lines.length; i++) {
    out.push(lines[i]);
    if (lines[i] === "}") return out.join("\n");
  }
  throw new Error(`function ${name} did not close`);
}

test("compare CSV export uses authenticated blob download, not window.open", () => {
  const src = loadMainSource();
  const start = src.indexOf('document.getElementById("exportBtn").onclick');
  assert.ok(start >= 0, "expected exportBtn handler");
  const end = src.indexOf("};", start);
  const handler = src.slice(start, end);
  assert.match(handler, /downloadBlobFromApiUrl\(/);
  assert.doesNotMatch(handler, /window\.open\(/);
  assert.match(
    src,
    /\/\*\* 已登录请求后触发浏览器下载（用于原 `target=_blank` 的导出，需带 Bearer） \*\//,
  );
});

test("overview JSON is HTML-escaped so imported warehouse names cannot break out of <pre>", () => {
  const src = loadMainSource();
  assert.match(src, /<pre>\$\{escapeHtml\(JSON\.stringify\(o, null, 2\)\)\}<\/pre>/);
  assert.doesNotMatch(src, /<pre>\$\{JSON\.stringify\(o, null, 2\)\}<\/pre>/);

  const code = ["escapeHtml", "overviewSection"]
    .map((n) => extractTopLevelFunction(src, n))
    .join("\n");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const payload = "</pre><img src=x onerror=alert(1)>";
  const html = sandbox.overviewSection({
    route_date: "2026-04-20",
    route_date_from: "2026-04-20",
    route_date_to: "2026-04-20",
    total: 1,
    warehouse_options: [payload],
  });
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("</pre><img"), false);
  assert.match(html, /&lt;\/pre&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
});
