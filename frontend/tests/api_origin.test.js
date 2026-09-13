const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const htmlPath = path.join(__dirname, "../index.html");
const mainPath = path.join(__dirname, "../src/main.js");

function inferFromMain(windowStub, apiPort = 8080) {
  const js = fs.readFileSync(mainPath, "utf8");
  const start = js.indexOf("function isDocumentedSplitPortFrontend");
  const end = js.indexOf("const API_ORIGIN");
  assert.ok(start >= 0 && end > start, "expected inferApiOrigin helpers in main.js");
  const context = vm.createContext({ window: windowStub, API_PORT: apiPort });
  vm.runInContext(`${js.slice(start, end)}\nthis.result = inferApiOrigin();`, context);
  return context.result;
}

test("index.html does not unconditionally pin API to location.origin", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(
    html,
    /<script>\s*window\.__API_ORIGIN__\s*=\s*location\.origin\s*;\s*<\/script>/,
  );
  assert.match(html, /port === "5173"/);
});

test("documented local :5173 ignores same-origin override and uses :8080", () => {
  assert.equal(
    inferFromMain({
      __API_ORIGIN__: "http://127.0.0.1:5173",
      location: { port: "5173", hostname: "127.0.0.1", protocol: "http:" },
    }),
    "http://127.0.0.1:8080",
  );
});

test("LAN split-port preview on :5173 uses same hostname :8080", () => {
  assert.equal(
    inferFromMain({
      __API_ORIGIN__: "http://192.168.1.20:5173",
      location: { port: "5173", hostname: "192.168.1.20", protocol: "http:" },
    }),
    "http://192.168.1.20:8080",
  );
});

test("production same-origin override is kept on default https port", () => {
  assert.equal(
    inferFromMain({
      __API_ORIGIN__: "https://route.example.com",
      location: { port: "", hostname: "route.example.com", protocol: "https:" },
    }),
    "https://route.example.com",
  );
});
