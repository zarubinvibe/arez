import { test } from "node:test";
import assert from "node:assert/strict";
import { platform } from "node:os";
import {
  assertLoopback, classifyContainment, witnessContainment, targetPolicy,
  spinUpConfined, sandboxPrefix, SandboxUnavailable, type Spawned,
} from "./phase-c.ts";
import type { SandboxPolicy } from "../vendor/olympuz/src/sandbox.ts";

test("assertLoopback пускает loopback-адреса, режет wildcard/LAN", () => {
  assert.doesNotThrow(() => assertLoopback(["127.0.0.1"]));
  assert.doesNotThrow(() => assertLoopback(["::1", "localhost"]));
  assert.throws(() => assertLoopback(["0.0.0.0"]), /не-loopback/);
  assert.throws(() => assertLoopback(["192.168.1.5"]), /не-loopback/);
  assert.throws(() => assertLoopback([]), /не подтверждён/); // непроверяемый бинд = отказ
});

test("containment реален только когда под seatbelt egress заблокирован, а без неё доходит", () => {
  assert.equal(classifyContainment(false, true).kind, "contained");
  assert.equal(classifyContainment(false, true).real, true);
});

test("egress прошёл ПОД seatbelt -> leaky (театр)", () => {
  const p = classifyContainment(true, true);
  assert.equal(p.real, false);
  assert.equal(p.kind, "leaky");
});

test("egress не прошёл и БЕЗ seatbelt -> inconclusive (полая канарейка)", () => {
  const p = classifyContainment(false, false);
  assert.equal(p.real, false);
  assert.equal(p.kind, "inconclusive");
});

test("witnessContainment: снятый containment ОБЯЗАН краснить канарейку", () => {
  // Реальная seatbelt: под ней egress режется, без неё доходит.
  const realCanary = (state: "confined" | "unconfined") => state === "unconfined";
  assert.equal(witnessContainment(realCanary).real, true);
  // Канарейка, зелёная даже со снятым containment (всегда «заблокировано»), - не доказывает изоляцию.
  const deadCanary = () => false;
  assert.equal(witnessContainment(deadCanary).kind, "inconclusive");
});

test("targetPolicy: сеть loopback, пишет только worktree, host-temp закрыт (ноль host-egress)", () => {
  const p = targetPolicy("/tmp/wt", ["/ro"]);
  assert.equal(p.network, "loopback");
  assert.deepEqual(p.write, ["/tmp/wt"]);
  assert.ok(p.read.includes("/tmp/wt") && p.read.includes("/ro"));
  assert.equal(p.allowGlobalTemp, false);
  assert.equal(p.processInfo, "deny");
});

// Спавнер и ready инъектируются - живой сервер не поднимаем, но весь fail-closed путь под проверкой.
const okPrefix = (_: SandboxPolicy) => ["sandbox-exec", "-f", "/x/god.sb"];
const listen = (addrs: string[], pids: number[]) => () => ({ addrs, pids });

test("spinUpConfined: наш процесс держит loopback-порт -> RunningTarget, url на 127.0.0.1", () => {
  const proc: Spawned = { exited: false, pid: 4242, reap() {} };
  const t = spinUpConfined(
    { worktree: "/tmp/wt", cmd: ["bun", "server.ts"], port: 8931 },
    okPrefix, () => proc, listen(["127.0.0.1"], [4242]),
  );
  assert.equal(t.url, "http://127.0.0.1:8931");
});

test("spinUpConfined: порт держит ЧУЖОЙ процесс (squatter) -> отказ + teardown (codex #5)", () => {
  let reaped = 0;
  const proc: Spawned = { exited: false, pid: 4242, reap() { reaped++; } };
  assert.throws(
    () => spinUpConfined({ worktree: "/tmp/wt", cmd: ["x"], port: 8931 }, okPrefix, () => proc, listen(["127.0.0.1"], [9999])),
    /чужой процесс/,
  );
  assert.equal(reaped, 1);
});

test("spinUpConfined: цель умерла до готовности -> падаем и сносим (fail-closed)", () => {
  let reaped = 0;
  const proc: Spawned = { exited: true, pid: 1, reap() { reaped++; } };
  assert.throws(
    () => spinUpConfined({ worktree: "/tmp/wt", cmd: ["x"], port: 8080 }, okPrefix, () => proc, () => null),
    /умерла до готовности/,
  );
  assert.equal(reaped, 1);
});

test("spinUpConfined: не-loopback бинд -> отказ + teardown", () => {
  let reaped = 0;
  const proc: Spawned = { exited: false, pid: 7, reap() { reaped++; } };
  assert.throws(
    () => spinUpConfined({ worktree: "/tmp/wt", cmd: ["x"], port: 8080 }, okPrefix, () => proc, listen(["0.0.0.0"], [7])),
    /не-loopback/,
  );
  assert.equal(reaped, 1);
});

test("teardown идемпотентен - reap ровно один раз даже при повторе", () => {
  let reaped = 0;
  const proc: Spawned = { exited: false, pid: 7, reap() { reaped++; } };
  const t = spinUpConfined({ worktree: "/tmp/wt", cmd: ["x"], port: 8080 }, okPrefix, () => proc, listen(["127.0.0.1"], [7]));
  t.teardown();
  t.teardown();
  assert.equal(reaped, 1);
});

// Своя seatbelt реальна на darwin и fail-closed вне его - проверяем оба исхода как утверждение, не как skip.
test("sandboxPrefix: на darwin даёт sandbox-exec, вне darwin - fail-closed (SandboxUnavailable)", () => {
  const policy = targetPolicy("/tmp/wt");
  if (platform() === "darwin") {
    const argv = sandboxPrefix(policy);
    assert.equal(argv[0], "sandbox-exec");
    assert.equal(argv[1], "-f");
  } else {
    assert.throws(() => sandboxPrefix(policy), SandboxUnavailable);
  }
});
