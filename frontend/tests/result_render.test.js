const assert = require("node:assert/strict");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.textContent = "";
  }

  appendChild(child) {
    this.children.push(child);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  get innerHTML() {
    const escapedText = String(this.textContent)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `${escapedText}${this.children.map((child) => child.innerHTML).join("")}`;
  }
}

const resultTable = new Element("tbody");

global.document = {
  createElement(tagName) {
    return new Element(tagName);
  },
  getElementById(id) {
    if (id === "resultTable") return resultTable;
    return null;
  },
};

const { renderResultRows } = require("../src/main.js");

const payload = '<img src=x onerror="globalThis.__xss = true">';

renderResultRows([
  {
    sys_waybill_no: payload,
    manual_waybill_no: "MAN001",
    match_status: "full",
    store_match_rate: 100,
    volume_diff_rate: null,
    line_consistent: true,
    est_distance_diff: null,
    est_duration_diff: null,
  },
]);

assert.equal(resultTable.children.length, 1);
assert.equal(resultTable.children[0].children[0].textContent, payload);
assert.equal(globalThis.__xss, undefined);
assert(!resultTable.innerHTML.includes("<img"));
