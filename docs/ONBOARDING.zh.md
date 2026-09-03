# 上手引导

[English](ONBOARDING.md) · [Русский](ONBOARDING.ru.md)

<img src="assets/pantheon/doc-onboarding.png" width="100%" alt="白色大理石的阿瑞斯站在石柱旁，伸手指向一块大理石板，一条红线从他的盾牌连到石板" />


这份走查是给从没跑过这类安全智能体的人看的。每一步都写清楚要输入什么、之后屏幕上会出现什么。如果你看到的是别的，就停在那里：答案在那处差别里，不在页面更下面。

你需要一台 Mac 或 Linux 机器，以及 Node.js 22 或更新。清单就这么长：这个项目零外部依赖，安装时什么都不下载。Arez 只在 `127.0.0.1`、在自己的沙箱里打活靶，绝不伸出你的机器。

1. **检查 Node。** 在终端里输入：

   ```bash
   node --version
   ```

   你会看到 `v22.11.0` 或更高的数字。出现 `command not found` 或 `v20.x`，说明 Node 没装或太旧：从 [nodejs.org](https://nodejs.org) 装当前 LTS，再查一次。

2. **拿到代码。** 用 git：

   ```bash
   git clone https://github.com/zarubinvibe/arez.git ~/arez
   cd ~/arez
   ```

   你会看到 `~/arez` 里多了一个文件夹，命令行提示符现在就在里面。没有 git？下载 [ZIP](https://github.com/zarubinvibe/arez/archive/refs/heads/main.zip)，解压，`cd` 进去。内容完全一样。

3. **运行安装脚本。**

   ```bash
   ./install.sh
   ```

   阿瑞斯用他自己的声音跟你打招呼，然后在做每一项检查之前先解释它：Node、git、可选的智能体 CLI，最后是他自己的门禁。机器上什么都不装。缺了必须的东西，他会直说并停下。

4. **读门禁结果。** 安装结束时你会看到：

   ```
   ✓ тесты: 59 из 59 зелёные, ноль пропущенных
   ✓ каталог: 6 сканеров на сиденье, инварианты держатся
   ✓ doctor: вендоренное ядро цело
   ```

   这就是整个工具在自证：零跳过的测试语料、坐在阿瑞斯座位上的六个扫描器、以及完整的被 vendored 内核。

5. **自己跑一遍完整门禁。**

   ```bash
   node bin/arez.ts gate
   ```

   你会看到 `gate: ✓ зелёный - фазы A-D, каталог и doctor сошлись`。这正是协调者在攻击方够不着的地方跑的那道门禁：测试、目录、doctor，以及端到端的 Deimos A–D 场景，最后给出一个退出码。

6. **检查被 vendored 的内核。**

   ```bash
   node bin/arez.ts doctor
   ```

   你会看到 `doctor: вендоренное ядро цело`。Arez 携带五个来自 Olympuz 的固定原语；doctor 把它们的字节和 `vendor/olympuz/PINNED.json` 比对，一有漂移就变红。

7. **看看六个扫描器。**

   ```bash
   node bin/arez.ts catalog
   ```

   你会看到阿瑞斯的座位：提供方 `claude`、`daimons:[]`，以及六个扫描器，其中 `deimos` 是总指挥。Deimos 把其余几个连成一条链，把它们的退出码汇成一个结论。

8. **弄懂什么才算一条发现。** 打开 `tests/CORPUS.md` 和 `AGENTS.md`。要带走的一条规矩：只有当一个独立进程看着利用测试在有漏洞的代码上变红、修好后变绿，才算一条发现。修之前就是绿的测试会被扔掉。Arez 证明，而不是猜。

9. **接下来。** 完整的阶段顺序在 `docs/MASTER-PLAN.md`。安全模型在 `SECURITY.md`。以后想让副本保持最新，就在 Claude Code 里运行 `/arez-update`，或者 `git pull` 再跑一次门禁。

---

觉得有用？给 [arez](https://github.com/zarubinvibe/arez) 点亮星标。想参与：先 fork，建分支，提交 commit，推送 push，然后开 Pull Request。请不要直接向 `main` 推送。

如果 Arez 是给你证明了一个洞、而不是猜了一个洞，这颗星只花几秒钟，对项目是真的有帮助。
