# pi-cc-clawd

Pi footer 右侧的 Clawd：跟着 Agent 状态做小动作的官方像素动画。默认 **8 列 × 2 行**，不增加 footer 行数。

## 兼容性（重要）

**必须使用支持 Kitty 图像协议的终端**，例如 Rex、Kitty、Ghostty。

- 本扩展通过 Kitty 的 Unicode 占位符（`U=1`）把图片放进 footer 单元格；iTerm2 的 OSC 1337 等协议没有等价的单元格网格，因此无法替代。
- **不支持 Kitty 协议的终端没有完整功能**：footer 里不会显示 Clawd，高画布的 overlay 舞台也不会出现；`/clawd` 命令仍可执行，但没有可见效果。
- 唯一的例外：没有捕获到兼容 footer 时，非 Kitty 终端会用 `belowEditor` 的 4 行文本半方块显示角色（占 4 行）。
- 图片能力由 Pi 自动探测，不会向不支持的终端发送图片序列，也不会残留占位符字符。

## 外观

- 固定的 **24×16 官方轮廓**，按真实字符单元像素等比缩放，不重画头身比例。
- footer 右侧 8 列 × 2 行，透明 PNG；Unicode 占位符让两行 footer 文字都能正常选择、复制。
- 两个以上工具并行时，同一块 8×2 区域拆成 **两只 4×2 小 Clawd**（各自独立的 Kitty 图片和 id），工具回落到一个后恢复整只；此模式不借舞台。
- 图标右侧固定留 **1 列空白**：部分终端会丢失行尾单元格的组合字符，贴边时右钳会被裁掉。
- 画布高于 footer 的动画临时使用 **8 列 × 2 行非捕获 overlay**，叠在编辑器底边框 + 输入行的右侧空白上，与 footer 组成 **8×4 舞台**；overlay 按 footer 的真实屏幕行定位（内容不足一屏时也不会掉到 footer 下面），主体保持 2.25 倍标准体型，不放大也不压扁。overlay 只在播放期间存在，其余时间完全移除。
- 没有捕获到兼容的两行 footer 时：Kitty 终端把同样的 **8×2 图标居中叠在原生 footer 的两行上**（非捕获 overlay），不额外占行，也不碰输入框；终端宽度小于 110 列时隐藏（原生 footer 的模型名会占到这里）。
- 非 Kitty 终端没法在 2 行里保住像素块的大小，因此保持 `belowEditor` 的 **4 行文本半方块**（每像素 1 格宽 × 半格高，形状可辨，但占 4 行）。
- 独立模式没有额外的编辑器行可用，高画布动画会等比缩放进这块区域。

## 动画与行为

官方 **6.6395.0** 的 base＋delta 目录，**25 组**全部可按需解码和播放。行为按触发来源组织：

| 类别 | 触发 | 动作 |
| --- | --- | --- |
| 工具映射 | `tool_execution_start` 的 `toolName`（`Bash` 还看命令） | `read`/`grep`/`find`/`ls` → `LookingAround`；`edit`/`write` → `Laptop`；`bash` → `Running`，其中测试／构建仍是 `Running`、`git commit/push/…` → `Laptop`、装包 → `CrabWalking`、`npm run dev`／`uvicorn` 等长跑服务 → `Desktop`；`web_search`/`fetch_content` → `LookingAroundEyesOnly`；`agent`/`task` → `Waving`；`ask_user_question` → `Pointing`；`todo_write` → `Thinking`；MCP 工具 → `Spark`；其它 → `CrabWalking` |
| 回合节点 | `agent_start`、`message_update` 的 `text_delta`、`turn_end`、`agent_settled` | 生成中 `Desktop`；**回答流式输出时改为 `Pointing` 比划讲解**，`message_end` 后回 `Desktop`；steer／follow-up 提示 `Jumping`；快速（≤15 秒）空回合结束 `JumpingHappy`，普通结束 `DancingHappy`，每第 10 次成功 `BreakDancing`，单回合 ≥12 次工具 `Confetti`；中断 `Disappointed`；失败 `Facepalm`；compact `Meditating` |
| 长任务 | 同一个工具连续运行 15 秒 | 在同族里换一场戏（如 `Running` ↔ `CrabWalking`、`Laptop` ↔ `Desktop`、`Waving` ↔ `Pointing`），避免长构建／长服务一直重复同 2 秒；只有单一 clip 的族不换 |
| 并行工具 | 同时运行的 `tool_execution_start` ≥2 | footer 的 8×2 拆成**两只 4×2 小 Clawd**，各用自己的 Kitty image id、按 8 fps 从墙钟取帧；此时不借舞台。剩一个工具后恢复整只 |
| 空闲小动作 | 眨眼独立每 4–7 秒一次；小动作每 6–10 秒一次（上下文紧张时 4–6 秒） | 眨眼不再占用小动作名额，避免一套动作里近一半都是眨眼；小动作池为左右看 + 8 组短动画（张望、扫视、转身、摇摆、走动、兴奋、呼啦、眩晕）与 7 组高画布（跳跃、挥手、灯泡、火花、彩带、跳跃开心、街舞）；用洗牌袋抽取，保证每一组在一轮内都会出现 |
| 系统状态 | 上下文百分比、回合时长、时段 | ≥85% 触发一次 `Dizzy`；同一回合生成 ≥2 分钟改用 `Swaying`；空闲 10 分钟（夜间 3 分钟）进入 `Meditating` 慢速睡眠，任意事件唤醒 |
| 交互 | 鼠标点击 footer 上的 Clawd（fullscreen）、`/clawd pet`、`Ctrl+Alt+C`、输入里的夸奖 | 单击随机 `Excited`／`Hula`／`Waving`／`DancingHappy` 一次，快速点 4 次改为 `Dizzy`；**“谢谢／thanks／干得漂亮”等夸奖**在回合中立刻 `Excited`，在空闲时记到下个回合开头；暂停时也可用。regular 模式 Pi 不把鼠标交给扩展，用命令或快捷键 |
| 场景／道具 | 工具类型与回合里程碑 | `Laptop`、`Desktop` 等自带道具的官方 clip；单回合工具 ≥12 次时，结束用 `Confetti` 场景代替普通舞蹈 |

节奏与防抖：

- 所有 clip 以官方 **12 fps** 播放；高画布 clip 借用 8×4 舞台，不放大主体；并行小 Clawd 用 **8 fps** 取帧，减少一条 footer 里的图片流量。
- 工具 clip **至少 20 帧（约 1.66 秒）**，避免毫秒级工具导致动作闪跳；最后一个工具结束后保留 **4 帧（约 0.33 秒）** 再切回生成动画，短暂间隙里的下一个工具不会打断动作。
- 并行工具以**最后启动**的那个决定主动作；≥2 个时整块 footer 切到两只小 Clawd（最多显示最早启动的两只），工具结束后回到仍在运行的那只。

状态直接来自 Pi 的 `agent_start`、`agent_settled`、`tool_execution_*`、`message_update`（仅 `text_delta`）、`message_end`、`input`、`turn_end` 和 compact 事件：**不让模型判断动画，也不产生额外模型请求**。

高画布的舞台取景：

- `Waving`、`Pointing`、`Thinking`、`Jumping`、`JumpingHappy`、`Lightbulb`：100%
- `Laptop`、`BreakDancing`：94%，`Spark`：91%
- `Confetti`：78%（画布 41px 宽，受 8 列宽度上限限制）

## 命令

| 命令 | 作用 |
| --- | --- |
| `/clawd` | 显示／隐藏 |
| `/clawd on` / `off` | 显示／隐藏并停止计时器 |
| `/clawd pause` / `resume` | 停止／恢复自动状态动画 |
| `/clawd blink` | 眨眼一次（暂停也可用） |
| `/clawd pet` | 摸一下，随机播放一个开心动作（暂停也可用） |
| `/clawd play <名称>` | 播放任意一组官方动画，补全列出全部 25 组 |
| `Ctrl+Alt+C` | 等同 `/clawd pet` |
| 鼠标点击 Clawd | 等同 `/clawd pet`（仅 fullscreen 模式；点舞台 overlay 同样有效） |

偏好作为本会话的扩展条目保存，`/reload` 或恢复会话后保留。命令不调用模型、不发聊天消息、不消耗 token，也不重建编辑器或清除输入草稿。

## 安装

需要 **Pi 1.5.2+**、**Node.js 22.19+**；运行时无额外依赖。

```bash
pi install npm:pi-cc-clawd
```

本扩展必须**注册在 `pi-cc-extensions` 之前**，否则捕获不到它的 footer，会退回 `belowEditor` 兜底。检查 `~/.pi/agent/settings.json` 的 `packages` 顺序即可（只调整顺序，不改动其他 package）：

```json
{ "packages": ["npm:pi-cc-clawd", "npm:pi-cc-extensions"] }
```

只保留一种安装来源，不要同时用软链接、package 安装和 `-e`。改完在 Pi 里执行 `/reload`。

## 已知限制

- overlay 会覆盖编辑器最后两行的右侧 8 列：编辑、子代理、提问、计划等带高画布道具的工具动作，以及 `/clawd play` 的高画布动画，都会临时占用这里；存在 `belowEditor` widget 时会压到 widget，自动补全或 `/` 菜单展开时右侧 8 列可能被遮住。
- 播放高画布动画期间，选中编辑器最后一行右侧有像素的格子可能复制出占位符字符；footer 两行的复制不受影响。
- 非 Kitty 终端没有 footer 显示（见上）。
- 鼠标点击只覆盖玻璃上的 8×2 格：从这些格子开始拖选不会选中 footer 文本；其余位置的选择、复制不受影响。regular 模式 Pi 不提供扩展鼠标事件，只能使用命令或快捷键。

## 开发

测试使用本机 Pi 的真实组件和 Jiti，不发起模型请求。

```bash
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run preview
```

当前 **127 个测试**通过，覆盖：全部 25 组素材的 base／delta 解码、15 组 footer 动画、8×4 舞台（占位符行号、体型不变性、边框掩码、overlay 生命周期）、触发（工具映射与命令细分、回合收尾、流式说话、长任务换场、夸奖、空闲时钟与动作池、上下文／长回合／睡眠、交互、彩带里程碑）、并行工具的双 mini（4×2、独立 image id、8 fps、两种真实渲染器上恢复整只）、偏好恢复、PNG／文本渲染、footer 尺寸与 fallback，以及 regular/fullscreen 两种真实渲染器上的选择与复制。

## 版权

非官方粉丝扩展，与 Anthropic 无官方关联；Claude、Clawd 名称和角色归 Anthropic。`assets/official-sprites.json` 包含从 Claude 6.6395.0 只读提取的官方 base＋delta 动画数据；MIT 只覆盖本项目原创代码。详见 [NOTICE](NOTICE) 与 [assets/README.md](assets/README.md)。