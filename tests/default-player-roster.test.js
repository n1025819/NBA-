const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const pages = ["index.html", "manual.html", "trade.html"];
const expectedPlayers = [
  { name: "James", pos: "F" },
  { name: "Rex", pos: "G" },
  { name: "Simon", pos: "G" },
  { name: "Kai", pos: "G", photoBase: "kai" },
  { name: "Kyle", pos: "G" },
];

function readDefaultPlayers(page) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  const match = html.match(/const defaultPlayers = (\[[\s\S]*?\n\]);/);
  assert.ok(match, `${page} must define defaultPlayers`);
  return vm.runInNewContext(`(${match[1]})`);
}

function readPhotoAliases(page) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  const match = html.match(/const photoAliases = (\{[\s\S]*?\n\s*\});/);
  assert.ok(match, `${page} must define photoAliases`);
  return vm.runInNewContext(`(${match[1]})`);
}

for (const page of pages) {
  const players = readDefaultPlayers(page);
  const photoAliases = readPhotoAliases(page);
  for (const expected of expectedPlayers) {
    const actual = players.find((player) => player.name === expected.name);
    assert.ok(actual, `${expected.name} must appear in ${page}`);
    assert.equal(actual.pos, expected.pos, `${expected.name} position in ${page}`);
    if (expected.photoBase) {
      assert.equal(
        photoAliases[expected.name],
        expected.photoBase,
        `${expected.name} photo alias in ${page}`,
      );
    }
  }
}

for (const { name, photoBase = name } of expectedPlayers) {
  const photo = path.join(root, "data", "照片", `${photoBase}.jpg`);
  assert.ok(fs.existsSync(photo), `${name}.jpg must exist in data/照片`);
}

const indexPlayers = readDefaultPlayers("index.html");
const indexPhotoAliases = readPhotoAliases("index.html");
const rosterPhotoNames = new Set(
  indexPlayers.flatMap((player) => [player.name, indexPhotoAliases[player.name]]).filter(Boolean),
);
const cardPhotoNames = fs
  .readdirSync(path.join(root, "data", "照片"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
  .map((entry) => path.parse(entry.name).name);
const missingFromRoster = cardPhotoNames.filter((name) => !rosterPhotoNames.has(name));
assert.deepEqual(
  missingFromRoster,
  [],
  `every top-level card photo must appear in the index roster; missing: ${missingFromRoster.join(", ")}`,
);

console.log("PASS: new participants exist on every roster page with matching photos");
