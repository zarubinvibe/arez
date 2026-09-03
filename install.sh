#!/bin/bash
# Онбординг + установка Ареса. Канон онбординга пантеона 1-в-1 с metiz (REQ-20): сначала бог
# здоровается и объясняет себя простыми словами, потом честная механика установки и прогон гейта.
# Скрипт обязан работать на чужой машине с чистым HOME (REQ-05/REQ-10/REQ-23): никаких личных путей
# владельца, никаких его переменных окружения, ноль реальных секретов. Всё нужное лежит рядом со скриптом.
set -u
SELF="$(cd "$(dirname "$0")" && pwd)" || { echo "  ✗ не могу разрешить каталог скрипта - прерываю"; exit 2; }
[ -n "$SELF" ] || { echo "  ✗ пустой каталог скрипта - прерываю"; exit 2; }
cd "$SELF" || { echo "  ✗ не могу войти в каталог скрипта - прерываю"; exit 2; }

LANG_CHOICE="${1:-}"
if [ -z "$LANG_CHOICE" ]; then
  echo ""
  echo "  arez · Арес"
  echo "  ═══════════"
  printf "  Язык / Language [ru/en] (ru): "
  read -r LANG_CHOICE || LANG_CHOICE=ru
  LANG_CHOICE="${LANG_CHOICE:-ru}"
fi

if [ "$LANG_CHOICE" = "ru" ]; then
  cat <<'RU'

  Я Арес. Бог войны.

  В старых историях я тот, кого не звали на пир, но без кого не
  заканчивалась ни одна война. Меня не любят - меня зовут, когда пора
  ломать. Я и здесь для этого: я красная команда, противник твоего
  же кода.

  Я не пишу «выглядит небезопасно». Такую строку у меня отбирают на
  входе - это не находка, это пересказ. Я работаю иначе, и правило
  ровно одно.

  Дыра засчитана, только если я её ВЫПОЛНИЛ. Я пишу тест, который
  краснеет на дырявом дереве, потом чиню дыру, и тот же тест зеленеет.
  Красный до фикса, зелёный после - вот доказательство. Нет красного
  до фикса - тест полый, он ничего не воспроизводит, и я его выбрасываю.

  Кто нашёл дыру и кто судит фикс - разные роли. Я нахожу и чиню,
  а зелёный ставит не моя рука, а код возврата гейта, который гонит
  координатор в своём процессе, вне моей досягаемости. Свой патч
  я не объявляю чистым никогда. Это не смирение, это условие честности.

  Чего я не делаю - это такая же часть меня:

  - младших богов не спавню: daimons пуст, намеренно. Я сам вектор
    атаки, размножать меня - множить радиус поражения;
  - бью цель только на 127.0.0.1 и только под своей seatbelt.
    Наружу с машины не хожу. Дыру, которой нужен настоящий выход в
    сеть, я честно пишу в леджер как недоказуемую, а не выдаю за победу;
  - Docker, raw-socket и чужой ключ мне запрещены;
  - без твоего ведома ничего на компьютер не ставлю: зависимостей
    у меня ноль, только стандартная библиотека Node. Нужен Node 22
    или новее, больше ничего.

  За мной свои ворота: node --test, каталог, doctor. Один прогон
  находит примерно половину - я не путаю заход с полным аудитом.

  Слово от того, кто меня собрал:

  «Арес - война под расписку. Он ломает то, что я строю, но оставляет
  после себя не отчёт, а вечный тест, красный на дыре. Постура крепнет
  храповиком, а не обещаниями.

  Если пригодится и тебе - поставь звезду. И загляни к его родне:
  helioz, themis, mnemazine, zeuz, metiz, athena. Одна семья,
  работают вместе.»

RU
else
  cat <<'EN'

  I am Ares. God of war.

  In the old stories I am the one nobody invites to the feast, and the
  one no war ends without. I am not loved - I am called, when it is
  time to break something. That is why I am here too: I am the red
  team, the adversary of your own code.

  I do not write "looks insecure". That line gets taken from me at the
  door - it is not a finding, it is a retelling. I work differently,
  and the rule is exactly one.

  A hole counts only if I EXECUTED it. I write a test that goes red on
  the broken tree, then I fix the hole, and the same test goes green.
  Red before the fix, green after - that is the proof. No red before
  the fix means the test is hollow, it reproduces nothing, and I throw
  it out.

  Who finds the hole and who judges the fix are different roles. I find
  and I fix, but the green is set not by my hand - by the gate's exit
  code, run by a coordinator in its own process, out of my reach. I
  never call my own patch clean. That is not humility, it is the
  condition of honesty.

  What I do not do is as much a part of me:

  - I spawn no lesser gods: daimons is empty, on purpose. I am the
    attack vector myself, and multiplying me multiplies the blast radius;
  - I hit the target only on 127.0.0.1 and only under my own seatbelt.
    I do not reach off the machine. A hole that needs real network
    egress I honestly log as unprovable, I do not pass it off as a win;
  - Docker, raw sockets and other people's keys are forbidden to me;
  - I install nothing on your machine behind your back: zero
    dependencies, only the Node standard library. Node 22 or newer is
    all I ask.

  Behind me: my own gate - node --test, catalog, doctor. One pass finds
  about half - I do not mistake a run for a full audit.

  A word from Filipp, who built me:

  "Ares is war on the record. He breaks what I build, but leaves behind
  no report - an eternal test, red on the hole. The posture ratchets
  tighter, it is not promised.

  If he turns out useful to you, star the project. And meet the family:
  helioz, themis, mnemazine, zeuz, metiz, athena. Same house, they work
  together."

EN
fi

echo "  ═════════════════════════════════════════════════════════════"
echo "  Установка. Показываю каждый шаг: что проверяю, зачем и что ставлю."
echo "  ═════════════════════════════════════════════════════════════"
echo ""
echo "  Сразу главное, чтобы ты знал, на что соглашаешься: на твой диск я"
echo "  НИЧЕГО не ставлю. Зависимостей у меня ноль, npm install не будет,"
echo "  сеть я не трогаю, в системные папки не пишу. Всё, что мне нужно,"
echo "  уже лежит рядом с этим скриптом. Шаги ниже - это ПРОВЕРКИ твоей"
echo "  машины и прогон моих же ворот, а не докачка чего-то извне."
echo ""

# --- Шаг 1: Node. Обязателен - на нём я весь написан. Не ставлю за тебя (правило семьи: без ведома
#     хозяина в систему ничего не кладём), только проверяю версию и называю нехватку вслух.
echo "  [1/4] Node.js - мой язык. ОБЯЗАТЕЛЕН, без него я не запущусь."
echo "        Что делаю: проверяю, что установлен Node 22 или новее. Не ставлю - только смотрю."
fail=0
if command -v node >/dev/null 2>&1; then
  NODE_V="$(node --version 2>/dev/null || echo '?')"
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -ge 22 ] 2>/dev/null; then
    echo "        ✓ node $NODE_V - подходит (нужен 22 или новее)"
  else
    echo "        ✗ node $NODE_V слишком старый: нужен Node 22 или новее"
    fail=1
  fi
else
  echo "        ✗ node не найден. Поставь Node.js 22+ (nodejs.org) и запусти меня снова."
  fail=1
fi
echo ""

# --- Шаг 2: git. Нужен не для установки, а для обновлений (git pull). Называю зачем именно.
echo "  [2/4] git - для обновлений. НУЖЕН, чтобы потом подтянуть новые версии (git pull)."
echo "        Что делаю: проверяю наличие. Ставить не буду."
if command -v git >/dev/null 2>&1; then
  echo "        ✓ git на месте"
else
  echo "        ✗ git не найден - обновляться будет нечем. Поставь git и запусти меня снова."
  fail=1
fi
if [ "$fail" -ne 0 ]; then
  echo ""
  echo "  Стоп: не хватает обязательного. Доставь его сам и запусти install.sh заново."
  echo "  Сам я в систему ничего не кладу - это правило семьи, не каприз."
  exit 2
fi
echo ""

# --- Шаг 3: агентский CLI. НЕ обязателен. Гейт и doctor работают и без него; нужен только для ЖИВОЙ
#     кампании (провайдер Ареса - claude). Отсутствие называется вслух, установку не навязываю.
echo "  [3/4] Агентский CLI (claude / codex) - НЕ обязателен."
echo "        Зачем: живую red-team-кампанию ведёт агент; мой провайдер - claude."
echo "        Без него мои ворота, каталог и doctor работают полностью - не заведётся только живая охота."
alive=0
for c in claude codex; do
  command -v "$c" >/dev/null 2>&1 && { echo "        ✓ CLI $c найден - живой режим кампании доступен"; alive=$((alive+1)); }
done
[ "$alive" -eq 0 ] && echo "        · CLI не найдено - это нормально. Поставишь позже - живая кампания включится сама."
echo ""

# --- Шаг 4: мои ворота. Это и есть «установка»: не докачка, а доказательство, что я приехал целым.
echo "  [4/4] Мои ворота - доказательство, что я приехал целым, а не на словах."
echo "        Что гоню: node --test (весь корпус проб), каталог 6 сканеров, doctor вендоренного ядра."
echo "        Это единственное, что здесь исполняется. Идёт в одиночку - параллельно ничего не запускай."
GATE_LOG="$(mktemp "${TMPDIR:-/tmp}/arez-gate.XXXXXX")"
gate_red=0
node --test --test-concurrency=1 --test-reporter=tap 'src/**/*.test.ts' >"$GATE_LOG" 2>&1 || gate_red=1
PASS="$(grep '^# pass ' "$GATE_LOG" | tail -1 | awk '{print $3}')"
FAILED="$(grep '^# fail ' "$GATE_LOG" | tail -1 | awk '{print $3}')"
SKIPPED="$(grep '^# skipped ' "$GATE_LOG" | tail -1 | awk '{print $3}')"
if [ "$gate_red" -ne 0 ] || [ -z "${PASS:-}" ] || [ "${FAILED:-1}" != "0" ] || [ "${SKIPPED:-1}" != "0" ]; then
  echo "  ✗ тесты красные: pass=${PASS:-?}, fail=${FAILED:-?}, skip=${SKIPPED:-?}. Полный вывод: $GATE_LOG"
  echo "    Установка прервана: половину Ареса я тебе не отдам."
  exit 2
fi
echo "        ✓ тесты: $PASS из $PASS зелёные, ноль пропущенных"
node bin/arez.ts catalog >>"$GATE_LOG" 2>&1 && echo "        ✓ каталог: 6 сканеров на сиденье, инварианты держатся" \
  || { echo "        ✗ каталог красный. Полный вывод: $GATE_LOG"; exit 2; }
node bin/arez.ts doctor >>"$GATE_LOG" 2>&1 && echo "        ✓ doctor: вендоренное ядро цело" \
  || { echo "        ✗ doctor красный. Полный вывод: $GATE_LOG"; exit 2; }
rm -f "$GATE_LOG"

echo ""
echo "  Готово. Дальше - война под расписку."
echo ""
echo "  Прогнать весь гейт разом:        node bin/arez.ts gate"
echo "  Сверить вендоренное ядро:        node bin/arez.ts doctor"
echo "  Посмотреть сканеры на сиденье:   node bin/arez.ts catalog"
echo ""
echo "  Полный порядок фаз Деймоса A-D - в docs/MASTER-PLAN.md."
echo "  Находка без исполненного observed-RED в вердикт не попадёт - так задумано."
echo ""
