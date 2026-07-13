const assert = require("node:assert/strict");
const test = require("node:test");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.innerHTML = "";
    this._textContent = "";
  }

  appendChild(child) {
    this.children.push(child);
  }

  replaceChildren() {
    this.children = [];
    this.innerHTML = "";
    this._textContent = "";
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
    this.innerHTML = "";
  }

  get textContent() {
    return this._textContent;
  }
}

test("result rows render imported waybill values as text", () => {
  const resultTable = new Element("tbody");
  global.document = {
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => (id === "resultTable" ? resultTable : null),
  };

  const { renderResultRows } = require("../src/main.js");
  const payload = '<img src=x onerror="globalThis.pwned=true">';

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

  assert.equal(resultTable.innerHTML, "");
  assert.equal(resultTable.children.length, 1);
  assert.equal(resultTable.children[0].children[0].textContent, payload);
  assert.equal(resultTable.children[0].children.length, 8);
  assert.equal(globalThis.pwned, undefined);
});
