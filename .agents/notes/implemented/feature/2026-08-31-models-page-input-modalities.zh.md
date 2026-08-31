# Agent Note: Models 页面可编辑输入模态

Status: implemented

[English](2026-08-31-models-page-input-modalities.md) | 中文

## Problem

两个 LLM 适配器早已声明了模型接受的请求模态，并且都在执行它：`llm-deepseek` 读取 `inputModalities`，`llm-pi-ai` 读取 `input`；当模型的列表不含 `image` 时，seam 会把图片降级为文本占位符，而 `llm-deepseek` 也依据同一声明计算图片载荷的计费。但这些在产品里都不可编辑。Models 设置页只编辑 `contextWindow` 和 `maxTokens` 就停住了，所以要声明一个多模态模型，只能离开 GUI 去改 `settings.yaml`。

[pi-ai 模态的决定](../architecture/2026-08-12-pi-ai-route-default-input-modalities.zh.md)确立了解析链，并有意关闭了配置界面："没有任何配置界面编辑 `input`。"本条推翻的正是这一排除。它所决定的解析部分全部按原样保留——条目 → catalog → route 的链、未声明即 `[text]`、条目的空列表表示"没有答案"而 route 的空列表被拒绝、以及 route 值是兜底而非覆盖——本条的写入器是为匹配它而建，而不是重新决策。

两个 family 对"声明缺失"的含义并不一致——这正是朴素的单一字段方案错的地方：

- `llm-deepseek` 把 `inputModalities` 默认为 `['text']`，且其 schema 拒绝空列表。
- `llm-pi-ai` 把缺失或空的 `input` 读作"此处没有答案"，并通过已安装 catalog 条目、进而 route 的 `defaultInput` 来解析。

## Decision

**两个模型目录编辑器都在每行原有的容量展开区内渲染一组 checkbox。** 该组提供 `text` 和 `image`，即 seam 当前声明的完整模态词汇。

**各 family 保留自己的字段名。** `src/client/modality.ts` 是唯一的写入者，它按 family 选择 `inputModalities` 或 `input`。共享一个名称被否决，因为空值语义不同：把 pi-ai 归一到 deepseek 的字段需要在每次读写都做映射，并且会把"声明为纯文本"压平成"继承"，而这个区别正是适配器解析时所观察的。

**text 是下限，不可清除。** 清除最后一个模态会恢复 `['text']` 而不是写入空列表——deepseek 的 schema 会拒绝空列表，而在 pi-ai 上空列表表达的是"什么都不接受"而非继承。

**显式声明不会因为它等于默认值而被丢弃。** 写入 `input: ['text']` 会被保留而不是删除。这正是 pi-ai 那一半的关键：缺失的 `input` 仍会经由已安装 catalog 解析，所以删除字段会把用户刚刚收窄的行又放大回 catalog 所说的样子。

**共享的逐行校验器变得感知 family。** `validateDeepSeekModels` 接受一个可选的 family，默认 `deepseek`，因此既有调用点无需改动，pi-ai 的调用点传入 `'pi-ai'`。它的模态规则只拒绝 checkbox 组写不出的值——超出这两个的模态、重复项、空列表或非数组——因为只有这些才是手工编辑 `settings.yaml` 时会带进页面的。

## Verification

包内测试直接覆盖写入器：两个字段名、text 下限、与点击顺序无关的顺序、未触及字段的保留，以及拒绝丢弃已收窄声明。组件测试渲染两个编辑器、展开一行，并断言切换 image 会写入该 family 的字段。把写入器改成什么都不记录后，其中七个用例变红，因此它们是行为证据而非覆盖率填充。`validateDeepSeekModels` 的用例锁定每个 family 读自己的字段、忽略对方的字段。i18n 文案归属门禁、locale 一致性 spec、`oxlint` 以及 client 聚合 `tsc -b` 均为绿。

## Alternatives considered

**一个共享字段名加转换层。** 否决：映射必须在每次读写都跑，且 pi-ai 那一半会丢掉其解析所依赖的"继承 vs 已声明"区别。

**自由文本或标签输入。** 否决：词汇是封闭的两值集合；自由字段会招来适配器拒绝的值，并且需要自己的校验文案。

**从 seam 的 `ModelModalityMap` 派生可提供的模态。** 否决：该 map 是可合并扩展的；seam 新增的模态是本页尚无法渲染与计费的，固定列表能让这个缺口保持可见，而不是画出一个解析不出东西的框。

**结果等于下限时删除字段。** 上文已否决——这正是 pi-ai 那些测试所防住的行为。

## Consequences

- 页面触碰过的行会带有显式模态声明，因此把某个 pi-ai 模型收窄为纯文本后，不会再静默继承 catalog 的列表。
- 扩展模态词汇需要同时修改 `MODALITY_CHOICES`、seam 的 `ModelModalityMap`、两个适配器的 gate，以及请求侧的降级与计费路径；页面的固定列表不会自己跟上。
- checkbox 组对没有声明的行显示解析后的下限，因此从 catalog 条目继承到 `['text','image']` 的 pi-ai 行，在被编辑之前会渲染成纯文本。这个读法是两个适配器都会解析出的结果，但界面并未把它标注为"继承"。
