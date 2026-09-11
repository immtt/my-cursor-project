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

function evalHelpers() {
  const src = loadMainSource();
  const names = [
    "escapeHtml",
    "matchStatusBadge",
    "formatCompareWaybillCell",
    "formatDiffStoresCell",
    "buildCompareResultTableRowsHtml",
  ];
  const code = names.map((n) => extractTopLevelFunction(src, n)).join("\n");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

test("compare result rows escape imported vehicle types as text", () => {
  const src = loadMainSource();
  assert.match(src, /<td>\$\{escapeHtml\(String\(r\.sys_vehicle_type \?\? "—"\)\)\}<\/td>/);
  assert.match(src, /<td>\$\{escapeHtml\(String\(r\.manual_vehicle_type \?\? "—"\)\)\}<\/td>/);
  assert.doesNotMatch(src, /<td>\$\{r\.sys_vehicle_type \?\? "—"\}<\/td>/);
  assert.doesNotMatch(src, /<td>\$\{r\.manual_vehicle_type \?\? "—"\}<\/td>/);

  const { buildCompareResultTableRowsHtml } = evalHelpers();
  const payload = '<img src=x onerror="globalThis.pwned=true">';
  const html = buildCompareResultTableRowsHtml([
    {
      id: 7,
      sys_waybill_no: "SYS-1",
      manual_waybill_no: "MAN-1",
      sys_vehicle_type: payload,
      manual_vehicle_type: payload,
      match_status: "full",
      store_match_rate: 100,
      same_stores: payload,
      diff_stores_system: payload,
      diff_stores_manual: "",
      match_score: 1,
      volume_diff: 0,
      line_consistent: 1,
      vehicle_type_consistent: 1,
      est_distance_diff: 0,
      est_duration_diff: 0,
    },
  ]);
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;img src=x onerror=&quot;globalThis\.pwned=true&quot;&gt;/);
  assert.equal(globalThis.pwned, undefined);
});

test("route-map warehouse meta interpolates through escapeHtml", () => {
  const src = loadMainSource();
  assert.match(src, /<strong>\$\{escapeHtml\(data\.warehouse_name \|\| "—"\)\}<\/strong>/);
  assert.doesNotMatch(src, /<strong>\$\{data\.warehouse_name \|\| "—"\}<\/strong>/);

  const { escapeHtml } = evalHelpers();
  const payload = '<img src=x onerror="alert(1)">';
  const html = `<div><strong>${escapeHtml(payload || "—")}</strong></div>`;
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});
