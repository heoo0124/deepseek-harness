# Post-mortem 0005: Deleting `node_modules` left gitignored build outputs stale, and every failure misreported as a runtime bug

English | [中文](0005-stale-gitignored-build-outputs-misreport-as-runtime-failures.zh.md)

Status: resolved (fix in `docs/development.md`; no product code changed)

## Executive summary

Deleting `node_modules` and reinstalling restored dependencies but not the gitignored build outputs under `packages/**/lib/` and `apps/web/dist/`. The browser then failed four times in a row, each with a message that named the wrong cause: `build:web` failed on a missing `worker.js`, two `missed the module table` errors named packages the source no longer imported, and `web boot: 33 entries did not activate` read like a plugin-tree misconfiguration when it actually meant the generated artifacts disagreed with each other. No product code was wrong. The durable fix is a documented whole-face build step, because the failure was a gap between `pnpm install` and what `dsh web` needs, not a defect in any package.

## Summary

A `dsh web` server booted from a source checkout could not render the UI. Over one session the same server produced four distinct failures. Each was chased and fixed individually — build one package, rebuild the frontend, restart — and each fix revealed the next failure, because every attempt rebuilt only the artifact whose absence the current message named. The whole class of failure resolved at once when the entire browser face was rebuilt with `pnpm run build:lib:client` followed by `pnpm run build:web`.

The trigger was deleting the repository's `node_modules` directory. `pnpm install` restores dependencies from the lockfile. It does not restore build outputs, and those outputs are gitignored, so Git cannot restore them either. A checkout in that state has current source and current dependencies but stale-to-absent generated artifacts, and nothing in the boot path reports that condition as "you have not built yet".

## Impact

The Web UI did not load for the duration of a full working session. No data loss and no incorrect behavior reached a user — the failures were all local, and every one aborted the boot rather than serving a wrong page. The cost was debugging time, spent four times over on a single underlying cause, because each failure message pointed at a plausible but different suspect. Anyone else who deletes `node_modules` and runs `dsh web` pays the same cost unless they build the whole face first.

## Timeline

- `pnpm install` after deleting `node_modules` completes; `pnpm dsh --profile web` serves on the requested port.
- **Failure 1** — `pnpm run build:web` fails: Rollup cannot resolve `@deepseek-ai/dsh-experimental-webworker-runtime/worker?worker`. The package's `exports` maps `"./worker"` to `./lib/worker.js`, which does not exist. The file is a gitignored tsdown output.
- The missing artifact is generated with `pnpm exec tsdown` in that package; `pnpm run build:web` then succeeds and the server is restarted.
- **Failure 2** — the browser reports `require("@deepseek-ai/dsh-client-store") missed the module table — not a platform seed word, not a materialized module, and no registered package factory`. `packages/client/web/src/platform.ts` lists `@deepseek-ai/dsh-client-store` in `PLATFORM_MODULES`, so the message's premise looks impossible.
- `packages/client/store/lib/index.js` is generated. `packages/client/web/lib/index.js` — the file that actually carries the seed table into the shell — is then found still dated from before the reinstall and rebuilt; the seed table gains `store`. The frontend is rebuilt and the server restarted.
- **Failure 3** — the browser reports the same `missed the module table` shape, now for `@deepseek-ai/dsh-session-log-export` requiring `@deepseek-ai/dsh-client-runtime/client`, a specifier no current source imports. Only `packages/session-query/session-log-export/lib/client.js` still carries it, from before the reinstall.
- That bundle is rebuilt. A scan of every generated `client.js` confirms zero remaining references to the old specifier.
- **Failure 4** — the browser reports `web boot: 33 entries did not activate`, every entry pending on `locale`, `sessions`, `settingsScope`, or a `remote.*` namespace. All 33 import successfully; none can start because no base service exists.
- Foundational client packages — `client/connection`, `api/remotes`, `extensions/cordis-client-runner` — are still dated from before the reinstall, while UI packages are current. Running `pnpm run build:lib:client` rebuilds the entire browser face in one pass; the frontend is rebuilt and the server restarted. The UI loads.

## Root cause

One condition produced all four failures: **the tree contained a mix of current and pre-reinstall generated artifacts, and the boot path cannot tell that from a broken build.**

The outputs are gitignored by design. `packages/**/lib/` holds each package's built `index.js`, `invariant.js`, and `client.js`; `apps/web/dist/` holds the Vite shell. Git tracks none of them, and `pnpm install` rebuilds none of them. A tree whose `node_modules` was deleted therefore has source and dependencies at one revision and artifacts at another, with no signal anywhere that a rebuild is pending.

Each failure was that condition observed through a different layer:

**Failure 1 is a build-time resolution error with an accurate message.** `exports["./worker"]` points at a file that does not exist, so Rollup reports the unresolved specifier. The misleading part is the framing — `apps/web` is not a standalone application, so the message arrives as a Vite/Rollup resolution failure rather than as "this package has not been built".

**Failures 2 and 3 are stale artifacts being served as truth.** The browser module table is built from what the artifacts say, not from what the source says. `packages/client/web/lib/index.js` carries `PLATFORM_MODULES` into the shell; a stale copy carries the seed list as it stood when it was built, so a seed the current source declares is simply absent, and the first plugin to require it fails. Failure 3 is the same mechanism one layer out: a stale `lib/client.js` still names an external its package stopped using, and the module table has no entry for it. Both messages say `a build-time externals drift, or a dynamic dependency that did not arrive` — which is a true description of the symptom and a misleading description of the cause, since nothing drifted in the source.

**Failure 4 is the condition that costs the most time, because its message inverts the diagnosis.** It does not name a missing module; it reports that 33 entries never activated, each waiting on services that nothing provided. Read literally, that is a dependency-graph problem — plugins declaring services nobody provides. What it actually means is that the packages which *do* provide `locale`, `sessions`, `settingsScope`, and the `remote.*` namespaces were stale, so their `apply()` never registered anything, while the UI packages that consume those services were current and imported cleanly. The entries are not misconfigured; their providers did not run. Nothing in the message says so.

The shared reason all four escaped: **there is no check that the artifacts are current.** Nothing compares artifact timestamps against source, nothing verifies that a package's declared `exports` resolve to existing files, and the boot path treats a stale artifact and an absent one identically.

## Why it was not caught earlier

- **The failures are only reachable from a tree in this specific state.** CI builds from clean, so it never has pre-existing artifacts to go stale. A developer who never deletes `node_modules` accumulates artifacts that are rebuilt as a side effect of ordinary work.
- **Each message is individually plausible.** A missing `worker.js`, a missing platform seed, an unregistered package factory, and 33 unmet service dependencies read as four unrelated defects. The pattern only becomes visible in retrospect, once the fourth fix turned out to be the one that ended the sequence.
- **The obvious remedy is the wrong one.** Rebuilding the one package a message names is the natural response and it works — for that message. It cannot end the sequence, because the next stale artifact is silent until the current one is fixed.
- **`pnpm install` printing success implies a ready tree.** It is not wrong about its own job, but the gap between "dependencies installed" and "artifacts built" is invisible until something tries to load them.

## Guardrails added

- **`docs/development.md`, First-time setup** — a new subsection, "Build the gitignored outputs before running `dsh web`", stating that `pnpm install` restores dependencies only, that `packages/**/lib/` and `apps/web/dist/` are gitignored, and that the whole face must be built (`pnpm run build:lib:client` then `pnpm run build:web`) rather than only the changed package. It lists all four failure shapes and says explicitly that `N entries did not activate` means the generated artifacts disagree with each other rather than that the plugin tree is misconfigured. Bilingual pair updated together.
- No product code changed. Every package involved behaved correctly given its inputs; the defect was a missing step between install and run.

## Deferred

The guardrail above is documentation: it tells a developer what to run, but nothing detects the condition automatically. A durable check would compare each package's generated outputs against its source and manifest — failing with `run pnpm run build:lib:client` when `exports` names a file that is absent, or when an artifact predates the sources it was built from — instead of letting the browser discover it as `missed the module table`. That is a build-tooling change with its own design questions about where the check lives and how it reports across faces, and it belongs in its own PR rather than in this write-up.

## Lessons

- `pnpm install` and a runnable tree are not the same state. When outputs are gitignored, the build is a separate step, and nothing warns when it is skipped.
- A stale artifact is not an absent one. It loads, it satisfies module resolution, and it carries a contract from a revision that no longer exists — which is why it produces errors about dependencies rather than errors about the build.
- When a fix removes one failure and immediately reveals a different one, suspect a shared condition before treating them as separate defects. Four messages here had one cause, and the sequence only ended when the whole face was rebuilt instead of the named package.
- `N entries did not activate` with every entry pending on base services means the providers did not run, not that the consumers are misconfigured. Check artifact timestamps before auditing the dependency graph.
- Failure messages that describe a symptom's category accurately can still misidentify its cause. `a build-time externals drift` was a correct description of what the module table observed and a wrong description of what had happened.
