const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class Element {
  constructor(id = null, tagName = "div") {
    this.id = id;
    this.tagName = tagName;
    this.children = [];
    this.innerHTML = "";
    this.textContent = "";
    this.onclick = null;
    this.files = [];
    this.value = "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
    this.innerHTML = "";
  }
}

function loadMainScript() {
  const elements = new Map();
  const document = {
    createElement: (tagName) => new Element(null, tagName),
    getElementById: (id) => {
      if (!elements.has(id)) {
        elements.set(id, new Element(id));
      }
      return elements.get(id);
    },
  };
  const sandbox = {
    document,
    window: {
      location: { hash: "#import" },
      addEventListener: () => {},
      open: () => {},
    },
    fetch: async () => ({ json: async () => ({}) }),
  };
  vm.createContext(sandbox);

  const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  vm.runInContext(`${source}\nthis.__renderResultRows = renderResultRows;`, sandbox);

  return {
    elements,
    renderResultRows: sandbox.__renderResultRows,
  };
}

test("result rows render imported values as text, not HTML", () => {
  const { elements, renderResultRows } = loadMainScript();
  const maliciousWaybill = '<img src=x onerror="globalThis.pwned=1">';

  renderResultRows([
    {
      sys_waybill_no: maliciousWaybill,
      manual_waybill_no: null,
      match_status: "full",
      store_match_rate: 100,
      volume_diff_rate: null,
      line_consistent: true,
      est_distance_diff: 0,
      est_duration_diff: null,
    },
  ]);

  const tableBody = elements.get("resultTable");
  assert.equal(tableBody.innerHTML, "");
  assert.equal(tableBody.children.length, 1);
  assert.equal(tableBody.children[0].children[0].textContent, maliciousWaybill);
  assert.equal(tableBody.children[0].children[1].textContent, "");
});
