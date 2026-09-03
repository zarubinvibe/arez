# Contributing

Clone, install nothing, run the gate:

```bash
git clone https://github.com/zarubinvibe/arez.git ~/arez
cd ~/arez
node bin/arez.ts gate
```

There are no dependencies to install. The gate runs the whole test corpus, the scanner catalog, the vendored-core doctor, and the end-to-end Deimos A–D acceptance scenario. It must come back with zero failures and zero skips.

Two rules make a review short:

- **A finding is proven, not asserted.** A change that fixes a security hole brings a regression test that is red on the broken tree and green after the fix. A test that stays green both before and after proves nothing and is rejected — that is the whole point of this tool.
- **The generator does not judge its own patch.** The verdict is the gate's exit code, not the author's opinion. Before a change is called done, another model provider reviews the code adversarially (see `AGENTS.md`, "Перекрёстная проверка").

`AGENTS.md` holds the rest: the doctrine, the invariants that live in tests, the layer rules, the vendored-code policy, and what the gate refuses. Read it before opening a pull request.

The path in: fork → branch → commit → push → Pull Request.
