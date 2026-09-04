# Arez

一支红队：用运行证明漏洞，再用红转绿的回归把它锁死，而不是写一份报告。

[English](README.md) · [Русский](README.ru.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) [![Stars](https://img.shields.io/github/stars/zarubinvibe/arez?style=flat&color=C9A87A)](https://github.com/zarubinvibe/arez/stargazers) [![Status](https://img.shields.io/badge/status-working-brightgreen.svg)](https://github.com/zarubinvibe/arez) [![Olympuz](https://img.shields.io/badge/olympuz-family-B8D6EA.svg)](https://github.com/zarubinvibe/athena#olympuz-family)

<p align="center"><img src="docs/assets/pantheon/hero.png" alt="白色大理石的阿瑞斯站在古典石柱旁：带盔冠的战盔，一支竖直、枪尖朝天的长矛，一面握在臂上的圆盾。盾面上有一道从红到绿的线。干净的红线把已证明的发现带向外面；柔和的金线被他握在手边。" width="100%"></p>

<!-- owner-welcome:start -->

> 你好。我不是工程师，我是律师。我为自己的任务用氛围编程（vibe-coding）做自己的工具。
>
> 我明白安全非常重要，所以做了这个工具。它靠真正发起攻击来检查我的代码，而不是靠猜。如果扫描器不能证明一个洞是真的，我不想听到它，现在我也不用听了：Arez 只报告它自己打破又修好的东西。
>
> 如果它也能这样帮到你，拿去，把它变成你自己的。
>
> — Filipp Zarubin

<!-- owner-welcome:end -->

## 目录

- [这是什么](#这是什么)
- [它解决什么问题](#它解决什么问题)
- [最大的优势](#最大的优势)
- [工作流程](#工作流程)
- [快速开始](#快速开始)
- [简单对比](#简单对比)
- [简单词汇](#简单词汇)
- [安全与隐私](#安全与隐私)
- [局限](#局限)
- [点亮星标与参与](#点亮星标与参与)

<!-- beginner-readme:start -->

## 这是什么

Arez 就是阿瑞斯，Olympuz 家族里的红队之神，被单独切出来做成一个工具。它对目标跑一场真正的安全战役。它先画出攻击面，再跑利用，只有当一个测试被亲眼看着在有漏洞的代码上变红、修好后变绿，才算一条发现。

这条回归之后就永远住在你自己的门禁里。阿瑞斯向你的代码开战，找出它的缺陷并把它们修好。他不是独自作战。Deimoz 是他的儿子，是随他冲进每一场战斗的恐惧，也是这里的引擎：他跑完整场战役，把各个扫描器汇成一个结论。他发起攻击，用跑通利用来证明每一个洞，再用一条回归把修复锁死。零外部依赖。它只在 127.0.0.1、在自己的沙箱里打活靶。

## 它解决什么问题

大多数安全智能体交给你一份报告：一堆看起来不安全的东西。其中一半不是真的，真的那些又淹没在噪声里。更糟的是，一个绿色测试可能压在一个从没动过的洞上面，谁都没发现。

Arez 不干这套。只有当利用被真正执行、修复被亲眼看着把洞关上，一条发现才算真的。如果你花钱让智能体查代码，你要的是标出来的确实存在，证明是一条你自己能跑的测试。

## 最大的优势

**最大的优势：** 只有在利用被跑过、并且修复被亲眼看着把测试从红变绿之后，一条发现才算数，而这份证明会作为一条你自己能跑的测试留下来。

**为什么这样更好：** 扫描器交给你一份报告就走了。Arez 做不到。它从不写「理论上攻击者可以」：跑不起来的说法会被拒绝。它从不相信一个在修复前就是绿的测试。它从不宣称自己的补丁干净；结论是门禁的退出码，由一个攻击方够不着的独立进程给出。一个需要真正对外网络才能证明的洞，会被记为 held，而不是当成战果。

## 工作流程

一场战役走过四个阶段。每一个都交给下一个可以核对的东西。在被执行并证明之前，什么都不算发现。

<!-- workflow-diagram:start -->

<p align="center"><img src="docs/assets/pantheon/takt-zh.png" alt="四块带金边的白色大理石板一字排开，一条发光的线把它们串起来，前三块是信号红，到最后一块转成绿色，旁边是一根凹槽大理石柱" width="100%"></p>

<!-- workflow-diagram:end -->

| 阶段 | 会发生什么 |
|---|---|
| 1. 侦察 | 在任何利用之前，先把攻击面画清楚 |
| 2. 利用 | 针对目标真正跑一次利用，拿回退出码 |
| 3. 证明 | 由协调者亲眼看着测试先红、修好后再绿 |
| 4. 落锁 | 回归永久留在门禁里 |

### 第 1 步：画出攻击面

第一步读清楚目标：哪些接口会应答，输入从哪里进来，智能体被允许碰什么。这一步还不攻击。没有扫描器标出的面，会被老实地放掉，而不是硬凑成一条发现。

<p align="center"><img src="docs/assets/pantheon/stage-recon.png" alt="Pantheon 宽幅大理石场景：Arez 流水线第 1 步，画出攻击面" width="100%"></p>

**你会得到：** 一张信任边界和输入点的地图，交给利用这一步。

### 第 2 步：跑利用

Ares 在 127.0.0.1、在自己的沙箱里，对目标跑真实的利用。回来的是一个退出码，不是一段话。「理论上攻击者可以」这种说法被拒绝。跑不起来的利用，不算发现。

<p align="center"><img src="docs/assets/pantheon/stage-exploit.png" alt="Pantheon 宽幅大理石场景：Arez 流水线第 2 步，跑利用" width="100%"></p>

**你会得到：** 一次带真实退出码的已执行利用，或一次老实的放弃。

### 第 3 步：看红转绿

证明不靠智能体自己说。一个独立的协调者在没修的代码上跑利用测试，看它失败；再在修好的代码上跑，看它通过。修前红、修后绿，这才是证明。修之前就已是绿的测试是空的，会被扔掉。

<p align="center"><img src="docs/assets/pantheon/stage-prove.png" alt="Pantheon 宽幅大理石场景：Arez 流水线第 3 步，证明红转绿" width="100%"></p>

**你会得到：** 一次被亲眼看到的红转绿，由退出码判定，智能体够不着。

### 第 4 步：锁死回归

证明了漏洞的那个测试，会变成一条永久的回归。之后每一次运行，只要缺陷一回来就立刻变红。防线随时间越收越紧，而不是每次从头再扫。这正是 Arez 和「交报告就忘」的扫描器不同的地方。

<p align="center"><img src="docs/assets/pantheon/stage-lock.png" alt="Pantheon 宽幅大理石场景：Arez 流水线第 4 步，锁死回归" width="100%"></p>

**你会得到：** 一条永久的测试，永远在缺陷上变红，就住在你自己的门禁里。

## 快速开始

你需要 Mac 或 Linux、Node.js 22 或更新，以及 git。做实时狩猎还想在终端里有一个智能体：`claude` 或 `codex`。从这里有三道门，哪一道都行。

```bash
git clone https://github.com/zarubinvibe/arez.git ~/arez
cd ~/arez

# Plain terminal, no agent needed: install checks your machine, then the gate proves the tool
bash install.sh
node bin/arez.ts gate

# In an editor: open the folder in Claude Code or VS Code
code .

# Drive a live campaign with an agent in the terminal
claude   # or: codex
```

没有 Git？下载 [ZIP](https://github.com/zarubinvibe/arez/archive/refs/heads/main.zip) 解压，在里面跑同样的 `./install.sh`。想在终端里用压缩包？拿 [tarball](https://github.com/zarubinvibe/arez/archive/refs/heads/main.tar.gz)。第一次用？在 Claude Code 里打开项目并运行 `/arez-setup`：安装会以对话进行，一次一个问题，没有你的同意什么都不跑。

第一次做这件事？[上手引导](docs/ONBOARDING.zh.md) 会一步一步带你走完第一次运行，并写清楚每条命令之后你会看到什么。

**你会得到：** 安装脚本先打招呼，看看你已经有什么，跑它自己的门禁，并老实说清楚在你的系统上哪些跑不起来。

## 简单对比

| 选项 | 花费 | 能证明吗？ | 可撤销 / 已锁 | 覆盖 | 代价 |
|---|---|---|---|---|---|
| **Arez** | 装一次，读一道门禁 | 能：被看着的红转绿 | 作为回归永久锁住 | 一个目标，很深 | 活靶沙箱需要 macOS |
| 交回 SARIF 的扫描器 | 一次快速扫描 | 不能：自说自话 | 什么都没锁 | 广但浅 | 报告一半不是真的 |
| 问模型「安全吗？」 | 一个很快的问题 | 不能：靠猜 | 什么都没锁 | 任何代码 | 压在真洞上的绿测试也能过 |
| 一队并行怀疑者 | 一次很多智能体 | 不能：意见不是运行 | 什么都没锁 | 纸面上很广 | 扇出会放大打击半径 |
| 用手工审代码 | 慢，仔细 | 只有你写了测试才行 | 只有你留着测试才行 | 够得着多少算多少 | 每遍要几个小时，人会累 |
| 换一个更大上下文的模型 | 完全不用配置 | 不能：还是猜 | 什么都没锁 | 一时都装得下 | 每一轮都要为每个字节再付一次 |

名称归各自所有者。此表描述用途，不是跑分：别的工具会变，本页不替它们打包票。

## 简单词汇

| 词 | 简单解释 |
|---|---|
| Repository | 仓库：Git 保存并记录版本的项目文件夹 |
| Terminal | 终端：你输入命令的窗口 |
| Command | 命令：给电脑的一条指令 |
| Branch | 分支：不影响 `main` 的另一条修改线 |
| Pull Request | 合并请求：请别人审阅并接受你的修改 |
| observed-RED | 只有当一个独立的协调者看着测试在有漏洞的代码上失败、在修好后通过，发现才算真。不是智能体嘴上说的，而是它亲眼看到的退出码。 |
| 空测试 | 一个在修复前后都是绿的测试。它什么都没复现，所以 Arez 把它扔掉，而不是叫它证明。 |
| seatbelt 沙箱 | 目标运行时所在的沙箱。只打 127.0.0.1，出不了你的机器，还有一只金丝雀证明这层隔离是真的。 |

## 安全与隐私

- Arez 是一个进攻性工具，被造成对自己的边界很老实。
- 它只在 127.0.0.1、在自己的操作系统级沙箱里打活靶，零对外流量。
- 它不派生子智能体。它故意是一片叶子，因为扇出会放大打击半径。
- 它从不用 Docker、裸套接字或别人的密钥。
- 需要网络或 shell 授权的步骤要过一次人工闸门。

门禁在一个攻击方够不着的独立进程里跑测试，所以工具不给自己的补丁下结论。一个需要真正出机器流量才能证明的洞，会被记为 held、无法证明，而不是被打扮成一次胜利。

## 局限

已经在跑：完整的攻击流水线、反表演内核、被 vendored 内核的 doctor，以及端到端的验收场景，全都通过门禁。接下来：当 Olympuz 蜂群组装时接上实时的 seat-adapter，以及一个可移植的沙箱，让活靶不只在 macOS 上起得来。

- 一场战役大约找到实际存在的一半。Arez 不把一次运行当成一次完整审计。
- 活靶沙箱目前需要 macOS；门禁和 doctor 到处都能跑。
- 实时狩猎需要一个智能体 CLI，Claude 或 Codex；没有它，门禁和 doctor 照样工作。
- strix 只是本地参照台，不是依赖。

`docs/MASTER-PLAN.md` 按依赖排出四个攻击阶段。`docs/ONBOARDING.md` 一步步带你完成第一次安装。`AGENTS.md` 存放教条与不变量。`SECURITY.md` 存放安全模型。`tests/CORPUS.md` 点名每一条探针。

## 点亮星标与参与

觉得有用？给 Arez 点亮星标：[https://github.com/zarubinvibe/arez](https://github.com/zarubinvibe/arez)。这只要一秒，却决定别人能不能找到这个项目。

想改点什么？流程很短：先 fork 仓库，建一个分支 branch，提交 commit，推送 push，然后开一个 Pull Request。请不要直接向 `main` 推送，发布闸门会拒绝。

发现问题？到 [https://github.com/zarubinvibe/arez/issues](https://github.com/zarubinvibe/arez/issues) 开一个 issue，写清楚你运行了什么、发生了什么。

<!-- beginner-readme:end -->

<!-- pantheon-family:start -->
## Olympuz 家族

这是 [Olympuz 家族](https://github.com/zarubinvibe/athena#olympuz-family) 的公开项目之一。表格里的每一行都可以打开仓库，或者直接下载源码压缩包。

| 类型 | 名称 | 做什么 | 获取 |
|---|---|---|---|
| 项目 | Athena | 可携带的智能体操作系统：在新的 Mac 上重建 Claude 与 Codex 的工作环境。 | [仓库](https://github.com/zarubinvibe/athena) · [ZIP](https://github.com/zarubinvibe/athena/archive/refs/heads/main.zip) |
| 项目 | Helioz | 全天候的智能体工作传送带，带可验证的完成标记和按目标做出的夜间决策。 | [仓库](https://github.com/zarubinvibe/helioz) · [ZIP](https://github.com/zarubinvibe/helioz/archive/refs/heads/main.zip) |
| 项目 | Mnemazine | 本地优先的记忆系统：把原始材料变成可复用的、已核验的知识。 | [仓库](https://github.com/zarubinvibe/mnemazine) · [ZIP](https://github.com/zarubinvibe/mnemazine/archive/refs/heads/main.zip) |
| 项目 | Themiz | 面向俄罗斯诉讼的多智能体助手，本地识别扫描件，五位法学家组成合议审阅。 | [仓库](https://github.com/zarubinvibe/themiz) · [ZIP](https://github.com/zarubinvibe/themiz/archive/refs/heads/main.zip) |
| 项目 | Zeuz | 工作流工厂：把一个想法变成带规则、闸门、可观测性和回放的多智能体系统。 | [仓库](https://github.com/zarubinvibe/zeuz) · [ZIP](https://github.com/zarubinvibe/zeuz/archive/refs/heads/main.zip) |
| 项目 | Lynceuz | 以零成本收集公开网页证据；安全路径走完时，它会给出诚实的理由并停下。 | [仓库](https://github.com/zarubinvibe/lynceuz) · [ZIP](https://github.com/zarubinvibe/lynceuz/archive/refs/heads/main.zip) |
<!-- pantheon-family:end -->

## 许可证

Apache-2.0，因为 Arez 携带了被 vendored 的 Olympuz 内核。
