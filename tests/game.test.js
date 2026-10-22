const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "public", "game.js"), "utf8");

test("game.js parses", () => { new Function(src); });
test("game exposes core mechanics", () => {
  for (const word of ["tryDash", "spawnRock", "spawnStar", "bumpCombo", "applyPower", "gameOver"]) {
    assert.ok(src.includes("function " + word), "missing " + word);
  }
});
