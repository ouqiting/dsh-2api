# dsh-epse-regeneration-guard

给 ds2api 适配用的 DeepSeek Harness（DSH）插件。当模型把 EPSE 工具调用框架（开标签 + 闭合标签成对出现）写进**文本回复**里、而不是发起原生工具调用时，agent 循环本会因「本轮没调用工具」而直接停止。本插件把这种回复**当作一次失败的模型请求**，让循环在原地重试。

## 行为

把坏回复判定为「请求失败」。这条原生路径由两半组成：

1. **`llm/stream`**：包裹提供方流，只观察模型的文本增量；一旦出现 EPSE 框架，就把末尾成功的 `finish` 换成携带 `EPSE_TOOL_CALL_FRAME` 的 `{ kind: 'error' }` finish。因为这次尝试以失败结束，循环**不会**为它追加 `assistant/message` —— 坏回复从未进入模型可见表面，所以事后无需删除任何东西。
2. **`agent/request-error`**：认领这个专属失败码，写下持久的 `llm/retry` / `llm/retry-started` 记录，返回 `{ kind: 'retry' }`。循环在**同一 turn、同一 step** 内基于未变的派生历史重新请求 —— 原始用户请求不会被重放，因此前端不会出现第二个用户气泡。


## 前端表现

- `llm/retry` 会让会话 UI 对该 step 的 assistant 节点执行 `resetForRetry`（清空 blocks 并置为 hidden），所以坏回复从对话中消失，重生成的回复渲染在它原来的位置。
- 该 step 会多出一行「已重试模型请求」的 retry 提示行，附带失败原因。这是 DSH 原生的重试呈现，也是这次重生成留下的唯一痕迹。

## 检测规则

文本中**同时存在**以下两者即判定命中（经归一化：全角形式如 `＜`、`ＥＰＳＥ` 经 NFKC 归一到 ASCII，再 lowercase 处理大小写）：

- **开标签**：前缀 `<|EPSE` / `<|epse` / `<EPSE`，后跟任意本地名、甚至本地名为空；
- **闭合标签**：前缀 `</|EPSE` / `</|epse` / `</EPSE`，后跟任意本地名、甚至本地名为空。

仅判定模型生成的**文本 chunk**（`text-delta` 与 text 型 `block-end`）；不处理写入文件、工具结果、工具参数、reasoning、日志事件。

## 适用范围与边界

只有普通的循环内会话请求会被守护，以下一律原样放行：

- `purpose` 非空的辅助调用（compaction、会话标题）；
- 非 `markAgentLoopRequest` 的手搭一次性调用；
- 找不到打开中 step 的请求（没有可重试的位置）；
- `targetProviders` 未覆盖的路由；
- `reason.kind` 不是 `stop` 的 finish —— `tool-calls` 说明模型**确实**发起了原生调用（格式正确，不是本插件的事），而已失败、已中止、被 max-tokens 截断的尝试各自保留自己的结局与恢复归属。

**防死循环**：按 `(session, turn, step)` 计数，每步最多强制失败 `maxRegenerationsPerTurn` 次（默认 2）。预算耗尽后坏回复正常落地，而不是让该轮永远失败。

## 配置

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `targetProviders` | `string[]` | `[]` | 限定命中的 provider / model 路由。**留空 = 对所有 agent 生效。** |
| `maxRegenerationsPerTurn` | `number` | `2` | 每个 step 最多强制重生成次数，防死循环。 |

`config` 仅在作为 bundle 行挂载时传入。

## 为什么不再用「删除 + 重发」

- **表层 `replace` 只影响模型，不影响前端。** 前端会话不折叠 `foldSurface`；它的每个消息 Definition 都要求 `isAppendSurfaceEvent`（即 `surfaceOp === 'append'`）。替换节点因此**不匹配任何 chat Definition**，而原来那条 append 来源的 `assistant/message` 仍持有自己的节点继续渲染。DSH 明确写下了这个意图（`dsh-session/surface.d.ts`）：*"replacement copies stay model-only"* —— 已落地的替换若真能擦除历史，就会抹掉用户已经看到的对话。引擎甚至禁止撤回已物化节点。
- **`agent.steer()` 必然产生第二个用户气泡。** steer 把消息放进 next-step inbox，循环在步边界把它作为 `user/message` 追加；`source.kind === 'user'` 的消息由 `UserMessageNodeView` 渲染成右对齐气泡（分类为 `steering`）。没有任何按内容去重的机制，消息 id 每次都是新的。

新方案让两个症状同时消失：坏回复根本不落地（无需删除），重试不携带新消息（无重复指令）。

## 安装

从 GitHub 仓库安装（需 dsh 命令行）：

```bash
dsh plugin --profile web add github:ouqiting/dsh-2api
```

Alternatively install from a local copy:

```bash
dsh plugin --profile web add ./<path-to>/dsh-2api
```

然后将其加入 profile 的 `dsh.profile.bundles`（或补丁层），例如：

```yaml
- insert:
    - id: epse-regeneration-guard
      name: '@ds2api/dsh-epse-regeneration-guard'
      config:
        maxRegenerationsPerTurn: 2
        targetProviders: []
```

## Token 与缓存影响

- 坏回复的输出 token 已经产生并计费，无法追回；但它**不进入**输入历史，所以重生成的请求与产生它的那次大小相同。
- 派生历史未发生任何表层替换，因此 KV cache 前缀完全可复用 —— 这优于旧方案（一次表面替换会使从首个被遮蔽消息起的复用失效）。

## 测试

```sh
node test.mjs
```

用真实 `Session`（表层与不变量规则原样生效）加最小假 Cordis context 驱动两个 listener，覆盖：坏回复转为被认领的请求失败并写下持久重试记录、干净回复与外部失败码原样放行、每步预算封顶、`targetProviders` 收窄范围。

## 已知限制

- 默认全局生效：`targetProviders` 留空意味着它作用于进程内所有 agent，包括运行 harness 自身的会话。
- 检测基于前缀：任何文本只要（归一化后）同时含 EPSE 开/闭合标签，就会被当作坏的工具调用框架，即使只是提到这些标签的普通叙述。但需要同时命中开、闭标签，已尽量避免误伤。
- 判定在流式过程中进行，早先的 chunk 已经推给了前端；用户可能短暂看到坏回复的前缀，随后被 retry 重置。
- 若同时挂载了 `@deepseek-ai/dsh-llm-retry` 且某路由配了 `always` mode，该插件可能先认领这次失败并按自己的策略重试。结果依然是原地重生成、无重复指令，只是退避与计数归它所有。

## License

MIT
