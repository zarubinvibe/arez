// Seat-adapter — arez встаёт на сиденье Ареса в Олимпусе с 0 правок кода (REQ-03).
//
// arez standalone, но при сборке роя Олимпуса он же занимает сиденье Ареса. Адаптер - единственная точка
// стыка: Олимпус импортирует aresSeat() и получает валидный дескриптор бога, не редактируя arez. Все
// инварианты семьи (провайдер claude, пол top, daimons:[], 6 сканеров) берутся из каталога arez, а не
// вписываются заново - один источник правды на оба режима.
import { loadCatalog } from "./catalog.ts";

export interface AresSeat {
  god: "ares";
  provider: string;
  minTier: string;
  /** LIM-01: Арес - лист. Пусто намеренно. */
  daimons: string[];
  /** 6 сканеров на сиденье (REQ-19). */
  skills: string[];
  soul: string;
}

export class SeatUnavailable extends Error {}

/**
 * Собирает дескриптор сиденья Ареса из каталога arez. Бросает, если каталог не держит инварианты - на
 * сиденье Ареса не встаёт полу-собранный бог. deimos среди навыков, но НЕ как имя бога: сиденье - ares,
 * не deimos (LIM-03: deimos на сиденье Ареса ломает assertDaimonAllowed).
 */
export function aresSeat(root: string): AresSeat {
  const cat = loadCatalog(root, false);
  if (!cat.ok) throw new SeatUnavailable(`каталог arez не держит инварианты сиденья: ${cat.problems.join("; ")}`);
  const m = cat.catalog!.models;
  return {
    god: "ares",
    provider: m.provider,
    minTier: m.minTier,
    daimons: m.daimons,
    skills: cat.catalog!.skills.scanners.map((s) => s.name),
    soul: "soul/gods/ares.md",
  };
}
