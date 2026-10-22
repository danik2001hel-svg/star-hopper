const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const pub = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(pub, "index.html"), "utf8");

test("has a title", () => assert.match(html, /<title>[^<]+<\/title>/i));
test("has a viewport meta tag", () => assert.match(html, /name="viewport"/i));
test("local src/href references exist", () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1])
    .filter((r) => !/^(https?:|mailto:|tel:|data:|\/\/)/.test(r));
  for (const r of refs) assert.ok(fs.existsSync(path.join(pub, r.replace(/^\//, ""))), "missing file: " + r);
});
