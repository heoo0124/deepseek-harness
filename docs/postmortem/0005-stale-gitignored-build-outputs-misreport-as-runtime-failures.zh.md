# 事故复盘 0005：删除 `node_modules` 后 gitignore 的构建产物陈旧，每次失败都误报为运行时缺陷

[English](0005-stale-gitignored-build-outputs-misreport-as-runtime-failures.md) | 中文

Status: resolved（修复位于 `docs/development.md`；未改动产品代码）

## 执行摘要

删除 `node_modules` 后重新安装只恢复了依赖，没有恢复 `packages/**/lib/` 与 `apps/web/dist/` 下被 gitignore 的构建产物。浏览器随后连续失败四次，每条信息都指向错误的原因：先是 `build:web` 因缺少 `worker.js` 失败；接着两次 `missed the module table` 点名了源码早已不再导入的包；最后 `web boot: 33 entries did not activate` 看起来像插件树配置有误，实际含义是生成产物彼此不一致。产品代码没有任何错误。持久修复是在文档中补充"构建整个 face"这一步骤，因为问题出在 `pnpm install` 与 `dsh web` 所需状态之间的缺口，而不是任何包的缺陷。

## 概述

从源码检出启动的 `dsh web` 服务无法渲染 UI。同一个服务在一次会话内产生了四种不同的失败。每种都被逐一排查和修复——构建一个包、重建前端、重启——而每次修复都会暴露下一种失败，因为每一次都只重建了当前信息所点名的那个产物。当整个浏览器 face 被 `pnpm run build:lib:client` 加 `pnpm run build:web` 一次性重建后，这一类失败同时消失。

触发条件是删除了仓库的 `node_modules` 目录。`pnpm install` 依据 lockfile 恢复依赖，但不恢复构建产物；这些产物又被 gitignore，Git 同样无法恢复。处于该状态的检出拥有最新的源码与依赖，生成产物却是陈旧甚至缺失的，而启动路径上没有任何环节把这种状态报成"你还没构建"。

## 影响

Web UI 在整整一个工作会话期间无法加载。没有数据丢失，也没有错误行为触达用户——所有失败都发生在本地，且每次都是中止启动，而不是提供一个错误的页面。代价是排查时间：同一个根因被付了四次，因为每条失败信息都指向一个看似合理却各不相同的嫌疑对象。任何删除过 `node_modules` 再运行 `dsh web` 的人，除非先构建整个 face，否则都要付同样的代价。

## 时间线

- 删除 `node_modules` 后 `pnpm install` 完成；`pnpm dsh --profile web` 在指定端口开始服务。
- **失败 1** —— `pnpm run build:web` 失败：Rollup 无法解析 `@deepseek-ai/dsh-experimental-webworker-runtime/worker?worker`。该包的 `exports` 把 `"./worker"` 映射到 `./lib/worker.js`，而该文件不存在，它是一个被 gitignore 的 tsdown 产物。
- 在该包内用 `pnpm exec tsdown` 生成缺失产物；`pnpm run build:web` 随之成功，服务重启。
- **失败 2** —— 浏览器报 `require("@deepseek-ai/dsh-client-store") missed the module table — not a platform seed word, not a materialized module, and no registered package factory`。而 `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 里明确列有 `@deepseek-ai/dsh-client-store`，因此这条信息的前提看起来不可能成立。
- 生成 `packages/client/store/lib/index.js`；随后发现真正把种子表带进 shell 的 `packages/client/web/lib/index.js` 仍是重装之前的旧产物，重建后种子表包含了 `store`。前端重建，服务重启。
- **失败 3** —— 浏览器报同样形态的 `missed the module table`，这次是 `@deepseek-ai/dsh-session-log-export` 请求 `@deepseek-ai/dsh-client-runtime/client`，而当前源码中没有任何地方导入这个标识符。只有 `packages/session-query/session-log-export/lib/client.js` 仍带着它，日期早于重装。
- 重建该 bundle。扫描所有生成的 `client.js`，确认对旧标识符的引用数为零。
- **失败 4** —— 浏览器报 `web boot: 33 entries did not activate`，每个条目都 pending 在 `locale`、`sessions`、`settingsScope` 或某个 `remote.*` 命名空间上。33 个条目全部导入成功，却都因为没有任何基础服务而无法启动。
- 基础 client 包——`client/connection`、`api/remotes`、`extensions/cordis-client-runner`——仍是重装之前的日期，而 UI 包是最新的。执行 `pnpm run build:lib:client` 一次性重建整个浏览器 face；前端重建，服务重启。UI 正常加载。

## 根因

四种失败来自同一个条件：**树中混有最新与重装之前的生成产物，而启动路径无法把这种状态与构建损坏区分开。**

这些产物被 gitignore 是设计如此。`packages/**/lib/` 存放每个包构建出的 `index.js`、`invariant.js` 和 `client.js`；`apps/web/dist/` 存放 Vite shell。Git 不追踪它们，`pnpm install` 也不重建它们。因此一个删除过 `node_modules` 的树，其源码与依赖处在一个修订版，产物却处在另一个修订版，并且没有任何信号提示需要重建。

每种失败都是该条件在不同层次上的表现：

**失败 1 是一条信息准确的构建期解析错误。** `exports["./worker"]` 指向一个不存在的文件，于是 Rollup 报出无法解析的标识符。误导性在于它的表述场景——`apps/web` 并非独立应用，所以这条信息以 Vite/Rollup 解析失败的形式出现，而不是"这个包尚未构建"。

**失败 2 和 3 是陈旧产物被当作事实在服务。** 浏览器模块表依据产物来构建，而不是依据源码。`packages/client/web/lib/index.js` 负责把 `PLATFORM_MODULES` 带进 shell；陈旧副本携带的是它构建时那份种子列表，于是当前源码声明的某个种子就是不存在，第一个请求它的插件随即失败。失败 3 是同一机制外移一层：陈旧的 `lib/client.js` 仍点名一个其所属包早已停用的外部依赖，模块表里没有对应条目。两条信息都写着 `a build-time externals drift, or a dynamic dependency that did not arrive`——这对症状是准确描述，对原因却是误导，因为源码里什么都没有漂移。

**失败 4 是耗时最长的一种，因为它的信息把诊断方向反了。** 它不点名缺失的模块，而是报告 33 个条目从未激活，每个都在等没有任何一方提供的服务。照字面理解，这是依赖图的问题——插件声明了无人提供的服务。而它的实际含义是：真正提供 `locale`、`sessions`、`settingsScope` 和 `remote.*` 命名空间的那些包是陈旧的，它们的 `apply()` 没有注册任何东西；而消费这些服务的 UI 包是最新的，导入完全正常。这些条目没有配置错误，是它们的提供者没有运行。信息里没有任何一处说明这一点。

四者共同逃逸的原因：**没有任何检查来验证产物是否最新。** 没有环节把产物时间戳与源码比较，没有环节校验一个包声明的 `exports` 是否解析到存在的文件，而启动路径对"陈旧产物"和"缺失产物"的处理完全一致。

## 为何更早没被发现

- **这些失败只有处于该特定状态的树才能触达。** CI 从干净状态构建，从不残留可能变陈旧的产物。从不删除 `node_modules` 的开发者，其产物会在日常工作中被顺带重建。
- **每条信息单独看都合理。** 缺失的 `worker.js`、缺失的平台种子、未注册的包工厂、33 个未满足的服务依赖，读起来像四个互不相关的缺陷。这个模式只有在事后才看得清——当第四次修复恰好成为终结整个序列的那一次时。
- **最自然的处置方式是错的。** 重建信息所点名的那个包是本能反应，而且对那条信息确实有效。但它无法终结序列，因为下一个陈旧产物在当前这个被修复之前一直保持沉默。
- **`pnpm install` 打印成功暗示树已就绪。** 就它自身的职责而言这没错，但"依赖已安装"与"产物已构建"之间的缺口，在有东西试图加载产物之前是不可见的。

## 已加入的护栏

- **`docs/development.md` 的 First-time setup** —— 新增小节"运行 `dsh web` 前先构建被忽略的产物"：说明 `pnpm install` 只恢复依赖、`packages/**/lib/` 与 `apps/web/dist/` 被 gitignore、必须构建整个 face（`pnpm run build:lib:client` 然后 `pnpm run build:web`）而不只是改动的那个包；列出全部四种失败形态，并明确指出 `N entries did not activate` 意味着生成产物彼此不一致，而不是插件树配置有误。双语对同步更新。
- 未改动产品代码。涉及的每个包在给定输入下行为都正确；缺陷出在安装与运行之间缺失的一步。

## 暂缓事项

上述护栏是文档：它告诉开发者该运行什么，但没有任何机制自动检测该状态。一个持久的检查应当把每个包的生成产物与其源码和 manifest 比对——当 `exports` 指向的文件不存在，或产物早于其构建来源时，以 `run pnpm run build:lib:client` 直接失败——而不是让浏览器以 `missed the module table` 的形式去发现它。这属于构建工具改动，并且自带设计问题（检查放在哪一层、如何跨 face 报告），应当独立成 PR，不属于本复盘。

## 经验

- `pnpm install` 与可运行的树不是同一种状态。当产物被 gitignore 时，构建是独立的一步，而跳过它时没有任何警告。
- 陈旧产物不等同于缺失产物。它能被加载、能满足模块解析，并携带一份已不存在于当前修订版的契约——正因如此，它产生的是关于依赖的错误，而不是关于构建的错误。
- 当一次修复移除一个失败却立刻暴露另一个失败时，先怀疑共同条件，而不是把它们当作不同缺陷。这里的四条信息源于同一个原因，而序列只有在不重建被点名的包、而是重建整个 face 时才终结。
- `N entries did not activate` 且每个条目都 pending 在基础服务上，意味着提供者没有运行，而不是消费者配置有误。在审计依赖图之前先检查产物时间戳。
- 准确描述了症状类别的失败信息，仍可能误判原因。`a build-time externals drift` 对模块表所观察到的现象是正确的，对实际发生的事情是错误的。
