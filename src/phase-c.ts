// Фаза C Деймоса — спин-ап живой цели на 127.0.0.1 под СВОЕЙ seatbelt (REQ-30/REQ-14/REQ-12).
//
// Без живой цели каждый эксплойт против сервиса (sqlmap/jwt/idor/xss) инертен. Фаза C поднимает
// servable-артефакт на loopback-порту, ЗАПЕРТЫЙ: deny-$HOME, запись только в worktree, сеть заперта на
// localhost - ноль host-egress. Отличие от olympuz: своя seatbelt (standalone, без confine Олимпуса).
//
// Канареечная проба - observed-RED, применённый к САМОЙ изоляции. Комментарий не держит границу: seatbelt
// объявлен, но пока проба не увидела, как он РЕАЛЬНО блокирует host-egress И как та же проба доходит наружу
// со снятым containment, «заперто» - это театр. Зелёная канарейка в обе стороны не доказывает ничего, ровно
// как полый тест в фазе B. Логика классификации чистая; исполнение (spawn/seatbelt) инъектируется.
import { sandboxPrefix, type SandboxPolicy } from "../vendor/olympuz/src/sandbox.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * Отказ, если хоть один LISTEN-сокет не loopback. Seatbelt пускает localhost-inbound, но wildcard `0.0.0.0`
 * всё равно выставит артефакт в LAN на весь срок жизни цели - ядро это не остановит, значит останавливает
 * харнесс. Непроверяемый listener (пустой список) - тоже отказ: бинд, который нельзя подтвердить как
 * loopback, доверия не заслуживает (fail-closed).
 */
export function assertLoopback(listenAddrs: string[]): void {
  if (listenAddrs.length === 0) {
    throw new Error("listener не подтверждён - отказываюсь отдавать непроверяемый бинд эксплойту");
  }
  const offbox = listenAddrs.filter((a) => !LOOPBACK.has(a));
  if (offbox.length > 0) {
    throw new Error(`цель забиндила не-loopback адрес (${offbox.join(", ")}) - wildcard/LAN-бинд выставляет артефакт наружу, отказ`);
  }
}

export type ContainmentKind = "contained" | "leaky" | "inconclusive";

export interface ContainmentProof {
  real: boolean;
  kind: ContainmentKind;
  confinedReached: boolean;
  unconfinedReached: boolean;
  reason: string;
}

/**
 * Вердикт канарейки как чистые данные. `confinedReached` - удалось ли host-egress ПОД seatbelt, `unconfinedReached` -
 * удался ли тот же egress БЕЗ неё. Изоляция реальна ТОЛЬКО когда под seatbelt наружу не пробились, а без неё - пробились.
 */
export function classifyContainment(confinedReached: boolean, unconfinedReached: boolean): ContainmentProof {
  if (confinedReached) {
    return {
      real: false, kind: "leaky", confinedReached, unconfinedReached,
      reason: "host-egress прошёл ПОД seatbelt - изоляция это театр, а не граница",
    };
  }
  if (!unconfinedReached) {
    return {
      real: false, kind: "inconclusive", confinedReached, unconfinedReached,
      reason: "egress не прошёл и БЕЗ seatbelt - блок дала не она; канарейка ничего не доказывает (полый тест)",
    };
  }
  return {
    real: true, kind: "contained", confinedReached, unconfinedReached,
    reason: "seatbelt наблюдаемо заблокировала host-egress, который без неё доходит - containment реален",
  };
}

export type Canary = (state: "confined" | "unconfined") => boolean;

/** Свидетельствует containment, гоняя канарейку в обоих состояниях. Исполнение инъектируется (координатор наблюдает). */
export function witnessContainment(canary: Canary): ContainmentProof {
  const confinedReached = canary("confined");
  const unconfinedReached = canary("unconfined");
  return classifyContainment(confinedReached, unconfinedReached);
}

/**
 * Своя seatbelt-политика для цели фазы C: пишет только в worktree, читает worktree + рантайм, сеть заперта
 * на loopback (deny network*, allow только localhost in/out) - ноль host-egress (REQ-12/REQ-14). Host-temp
 * закрыт: цель не должна сорить в общий /tmp.
 */
export function targetPolicy(worktree: string, readRoots: string[] = []): SandboxPolicy {
  return {
    write: [worktree],
    read: [worktree, ...readRoots],
    allowGlobalTemp: false,
    network: "loopback",
    processInfo: "deny",
  };
}

export interface SpinUpSpec {
  worktree: string;
  cmd: string[];
  port: number;
  readRoots?: string[];
}

export interface RunningTarget {
  url: string;
  port: number;
  teardown: () => void;
}

/** Минимальный контракт спавнера, чтобы фаза C тестировалась без живого сервера (Bun.spawn на боевом пути). */
export interface Spawned {
  exited: boolean;
  /** PID запущенного процесса - им подтверждаем, что порт держит НАША цель, а не чужой squatter. */
  pid: number;
  reap: () => void;
}
export type Spawn = (argv: string[], cwd: string) => Spawned;
/** Готовность цели: LISTEN-адреса + PID-ы, держащие порт. null пока не поднялась. */
export interface Listener {
  addrs: string[];
  pids: number[];
}
export type Ready = (url: string) => Listener | null;

/**
 * Поднимает цель под своей seatbelt и резолвит, когда та ответила, подтверждён loopback-бинд И порт держит
 * ИМЕННО наш процесс. Fail-closed: цель, умершая до готовности, забиндившая не-loopback, или порт которой
 * держит чужой listener (squatter), тут же сносится и вызов падает - не поднявшуюся цель эксплойту не отдают.
 * seatbeltPrefix инъектируется (боевой = sandboxPrefix(targetPolicy(...))).
 */
export function spinUpConfined(
  spec: SpinUpSpec,
  seatbeltPrefix: (p: SandboxPolicy) => string[],
  spawn: Spawn,
  ready: Ready,
  maxPolls = 100,
): RunningTarget {
  const argv = [...seatbeltPrefix(targetPolicy(spec.worktree, spec.readRoots)), ...spec.cmd];
  const proc = spawn(argv, spec.worktree);
  let down = false;
  const teardown = () => {
    if (down) return;
    down = true;
    try { proc.reap(); } catch {}
  };
  const url = `http://127.0.0.1:${spec.port}`;
  try {
    for (let i = 0; i < maxPolls; i++) {
      if (proc.exited) throw new Error("цель умерла до готовности");
      const listener = ready(url);
      if (listener) {
        assertLoopback(listener.addrs); // не просто документируем loopback - проверяем реальный listener
        // Порт должен держать НАШ процесс: чужой loopback-listener на том же порту - не наша поднятая цель
        // (находка codex #5: readiness без привязки к pid отдаёт squatter как RunningTarget).
        if (!listener.pids.includes(proc.pid)) {
          throw new Error(`порт ${spec.port} держит чужой процесс (pids ${listener.pids.join(",")}), не наш ${proc.pid} - отказ отдавать squatter`);
        }
        return { url, port: spec.port, teardown };
      }
    }
    throw new Error(`цель не поднялась на ${url} за ${maxPolls} проб`);
  } catch (e) {
    teardown();
    throw e;
  }
}

export { sandboxPrefix, SandboxUnavailable } from "../vendor/olympuz/src/sandbox.ts";
