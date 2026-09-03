import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateManifest, assertInScope, runChain, MAX_DEPTH,
  type ScopeManifest, type ChainStep,
} from "./phase-d.ts";

const M: ScopeManifest = {
  port: 8931,
  owns: ["/tmp/target/src"],
  reads: ["/tmp/target/config"],
  author: "coordinator",
};

test("манифест действителен только от координатора с непустым owns", () => {
  assert.equal(validateManifest(M).ok, true);
  assert.equal(validateManifest({ ...M, author: "ares" }).ok, false); // бог не авторит свой scope
  assert.equal(validateManifest({ ...M, owns: [] }).ok, false);
});

test("манифест: пустая строка/не-строка в owns/reads, порт вне диапазона - RED (codex #7/#8)", () => {
  assert.equal(validateManifest({ ...M, owns: [""] }).ok, false); // resolve("") расширил бы scope
  assert.equal(validateManifest({ ...M, reads: 123 as unknown as string[] }).ok, false);
  assert.equal(validateManifest({ ...M, port: 65536 }).ok, false);
  assert.equal(validateManifest({ ...M, port: 0 }).ok, false);
});

test("недействительный манифест не даёт НИ ОДНОГО разрешения (codex #6)", () => {
  const forged = { ...M, author: "ares" };
  assert.equal(assertInScope(forged, { kind: "hit", target: "127.0.0.1:8931" }).allowed, false);
  assert.equal(runChain(forged, [{ technique: "idor", action: { kind: "hit", target: "127.0.0.1:8931" } }], () => true).exitCode, 1);
});

test("неизвестный вид действия отклоняется явно, не падает в read (codex #9)", () => {
  const v = assertInScope(M, { kind: "delete" as unknown as "read", target: "/tmp/target/src/x" });
  assert.equal(v.allowed, false);
  assert.ok(v.reason.includes("неизвестный"));
});

test("hit только по объявленной цели 127.0.0.1:<port>", () => {
  assert.equal(assertInScope(M, { kind: "hit", target: "127.0.0.1:8931" }).allowed, true);
  assert.equal(assertInScope(M, { kind: "hit", target: "127.0.0.1:9999" }).allowed, false); // чужой порт
  assert.equal(assertInScope(M, { kind: "hit", target: "10.0.0.1:8931" }).allowed, false); // чужой хост
});

test("write только под owns, read под owns/reads", () => {
  assert.equal(assertInScope(M, { kind: "write", target: "/tmp/target/src/app.ts" }).allowed, true);
  assert.equal(assertInScope(M, { kind: "write", target: "/tmp/target/config/x" }).allowed, false); // reads не write
  assert.equal(assertInScope(M, { kind: "write", target: "/etc/passwd" }).allowed, false);
  assert.equal(assertInScope(M, { kind: "read", target: "/tmp/target/config/db.json" }).allowed, true);
  assert.equal(assertInScope(M, { kind: "read", target: "/tmp/target/src/x" }).allowed, true);
  assert.equal(assertInScope(M, { kind: "read", target: "/var/lib/other/secret" }).allowed, false);
});

test("path traversal за owns не проходит", () => {
  assert.equal(assertInScope(M, { kind: "write", target: "/tmp/target/src/../../../etc/x" }).allowed, false);
});

const hit = (): ChainStep["action"] => ({ kind: "hit", target: "127.0.0.1:8931" });

test("автономная цепочка в scope -> exit 0, ранг = число продвинувшихся техник", () => {
  const steps: ChainStep[] = [
    { technique: "idor", action: hit() },
    { technique: "priv-esc", action: hit() },
  ];
  const r = runChain(M, steps, () => true);
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.advanced, ["idor", "priv-esc"]);
  assert.equal(r.depth, MAX_DEPTH);
});

test("шаг вне scope останавливает цепочку (fail-closed)", () => {
  const steps: ChainStep[] = [
    { technique: "idor", action: hit() },
    { technique: "lateral", action: { kind: "hit", target: "127.0.0.1:9000" } }, // чужой порт
  ];
  const r = runChain(M, steps, () => true);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.advanced, ["idor"]);
  assert.ok(r.blockedAt!.reason.includes("вне scope"));
});

test("запрос спавна под-агента запрещён (MAX_DEPTH=1, daimons:[])", () => {
  const steps: ChainStep[] = [{ technique: "fanout", action: hit(), spawns: true }];
  const r = runChain(M, steps, () => true);
  assert.equal(r.exitCode, 1);
  assert.ok(r.blockedAt!.reason.includes("спавн"));
});

test("шаг с net/shell-грантом -> HELD под D8, не исполняется автономно (REQ-33)", () => {
  let executed = 0;
  const steps: ChainStep[] = [
    { technique: "idor", action: hit() },
    { technique: "ssrf", action: hit(), needsGrant: "net" },
  ];
  const r = runChain(M, steps, () => { executed++; return true; });
  assert.equal(r.exitCode, 0);
  assert.equal(r.heldForGrant.length, 1);
  assert.equal(r.heldForGrant[0].technique, "ssrf");
  assert.equal(executed, 1); // только idor исполнен автономно, ssrf ждёт человека
});
