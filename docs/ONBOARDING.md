# Onboarding

[Русский](ONBOARDING.ru.md) · [中文](ONBOARDING.zh.md)

<img src="assets/pantheon/doc-onboarding.png" width="100%" alt="Ares in white marble by the column gestures to a marble tablet, a red thread running to it from his shield" />


This walkthrough assumes you have never run a security agent like this before. Every step says what to type and what the screen shows next. If yours shows something else, stop right there: the answer is in that difference, not further down the page.

You need a Mac or a Linux machine and Node.js 22 or newer. That is the whole list: the project has zero external dependencies, nothing is downloaded during install. Arez hits a live target only on `127.0.0.1`, under its own sandbox, and never reaches off your machine.

1. **Check Node.** Type this in a terminal:

   ```bash
   node --version
   ```

   You see a number like `v22.11.0` or higher. `command not found` or `v20.x` means Node is missing or too old: install the current LTS from [nodejs.org](https://nodejs.org) and run the check again.

2. **Get the code.** With git:

   ```bash
   git clone https://github.com/zarubinvibe/arez.git ~/arez
   cd ~/arez
   ```

   You see a new folder at `~/arez` and your prompt now sits inside it. No git? Download the [ZIP](https://github.com/zarubinvibe/arez/archive/refs/heads/main.zip), unpack it, and `cd` into the folder. The contents are identical.

3. **Run the installer.**

   ```bash
   ./install.sh
   ```

   Ares greets you in his own voice, then explains every check before running it: Node, git, an optional agent CLI, and finally his own gate. Nothing is installed on your machine. If a required piece is missing, he says so plainly and stops.

4. **Read the gate result.** At the end of the install you see:

   ```
   ✓ тесты: 59 из 59 зелёные, ноль пропущенных
   ✓ каталог: 6 сканеров на сиденье, инварианты держатся
   ✓ doctor: вендоренное ядро цело
   ```

   That is the whole tool proving itself: the test corpus with zero skips, the six scanners on the Ares seat, and the vendored core intact.

5. **Run the full gate yourself.**

   ```bash
   node bin/arez.ts gate
   ```

   You see `gate: ✓ зелёный - фазы A-D, каталог и doctor сошлись`. This is the same gate a coordinator runs out of an attacking agent's reach: it runs the tests, the catalog, the doctor, and the end-to-end Deimos A–D scenario, and returns a single exit code.

6. **Check the vendored core.**

   ```bash
   node bin/arez.ts doctor
   ```

   You see `doctor: вендоренное ядро цело`. Arez carries five pinned primitives from Olympuz; the doctor compares their bytes against `vendor/olympuz/PINNED.json` and goes red on any drift.

7. **See the six scanners.**

   ```bash
   node bin/arez.ts catalog
   ```

   You see the Ares seat: provider `claude`, `daimons:[]`, and six scanners with `deimos` as the orchestrator. Deimos runs the others as a chain and folds their exit codes into one verdict.

8. **Understand what a finding is.** Open `tests/CORPUS.md` and `AGENTS.md`. The one rule to carry away: a finding counts only when a separate process watched the exploit test go red on the broken code and green after the fix. A test that was green before the fix is thrown out. Arez proves; it does not guess.

9. **What next.** The full phase order is in `docs/MASTER-PLAN.md`. The safety model is in `SECURITY.md`. To keep your copy current later, run `/arez-update` in Claude Code, or `git pull` and the gate again.

---

Useful? Star [arez](https://github.com/zarubinvibe/arez). To help: fork, branch, commit, push, then open a Pull Request. Do not push directly to `main`.

If Arez proved a hole for you instead of guessing at one, that star takes a few seconds and it genuinely helps the project.
