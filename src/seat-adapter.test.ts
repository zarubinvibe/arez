import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { aresSeat, SeatUnavailable } from "./seat-adapter.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("aresSeat: дескриптор сиденья из каталога дома держит инварианты семьи (REQ-03/REQ-19)", () => {
  const seat = aresSeat(ROOT);
  assert.equal(seat.god, "ares");
  assert.equal(seat.provider, "claude");
  assert.equal(seat.minTier, "top");
  assert.deepEqual(seat.daimons, []); // LIM-01
  assert.equal(seat.skills.length, 6); // REQ-19
  assert.ok(seat.skills.includes("deimoz"));
});

test("сиденье - ares, а не deimoz: имя бога не совпадает с навыком-оркестратором (LIM-03)", () => {
  const seat = aresSeat(ROOT);
  assert.notEqual(seat.god as string, "deimoz");
});

test("полу-собранный каталог -> SeatUnavailable, на сиденье не встаёт", () => {
  const dir = mkdtempSync(join(tmpdir(), "arez-seat-"));
  mkdirSync(join(dir, "catalog"));
  writeFileSync(join(dir, "catalog/models.json"), JSON.stringify({ seat: "ares", provider: "kimi", minTier: "top", daimons: [], tiers: {} }));
  writeFileSync(join(dir, "catalog/skills.json"), JSON.stringify({ scanners: [] }));
  try {
    assert.throws(() => aresSeat(dir), SeatUnavailable);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
