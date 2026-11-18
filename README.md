# pi-cc-clawd

Pi footer 右侧的 Clawd：跟着 Agent 状态做小动作的官方像素动画。默认 **8 列 × 2 行**，不增加 footer 行数。

## 兼容性（重要）

**必须使用支持 Kitty 图像协议的终端**，例如 Rex、Kitty、Ghostty。

- 本扩展通过 Kitty 的 Unicode 占位符（`U=1`）把图片放进 footer 单元格；iTerm2 的 OSC 1337 等协议没有等价的单元格网格，因此无法替代。
- **不支持 Kitty 协议的终端没有完整功能**：footer 里不会显示 Clawd，高画布的 overlay 舞台也不会出现；`/clawd` 命令仍可执行，但没有可见效果。
- 唯一的例外：没有捕获到兼容 footer、退回 `belowEditor` widget 时，非 Kitty 终端会用 4 行半方块文本显示角色。
- 图片能力由 Pi 自动探测，不会向不支持的终端发送图片序列，也不会残留占位符字符。

## 外观

- 固定的 **24×16 官方轮廓**，按真实字符单元像素等比缩放，不重画头身比例。
- footer 右侧 8 列 × 2 行，透明 PNG；Unicode 占位符让两行 footer 文字都能正常选择、复制。
- 图标右侧固定留 **1 列空白**：部分终端会丢失行尾单元格的组合字符，贴边时右钳会被裁掉。
- 画布高于 footer 的动画临时使用 **8 列 × 2 行非捕获 overlay**，叠在编辑器底边框 + 输入行的右侧空白上，与 footer 组成 **8×4 舞台**；主体保持 2.25 倍标准体型，不放大也不压扁。overlay 只在播放期间存在，其余时间完全移除。
- 没有捕获到兼容的两行 footer 时，用 `belowEditor` 4×1 兜底（Kitty 图片或 4 行文本半方块），不重绘编辑器。

## 动画与状态

官方 **6.6395.0** 的 base＋delta 目录，**25 组**全部可按需解码和播放。

| 状态 | 动画 |
| --- | --- |
| Agent 生成中 | `Desktop` 循环 |
| 工具执行中 | `CrabWalking` 循环，并行工具全部结束后才返回生成状态 |
| 完成 | `DancingHappy` 一次 |
| compact | `Meditating` 循环 |
| 出错 | `Facepalm` 一次后恢复当前状态 |
| 空闲 | 原生眨眼／张望 + 随机短动画（约 4.5–8 秒一次） |

状态直接来自 Pi 的 `agent_start`、`agent_settled`、`tool_execution_*`、`turn_end` 和 compact 事件：**不让模型判断动画，也不产生额外模型请求**。

状态机只使用 15 组短画布动画，避免工作中角色尺寸变化。另外 10 组高画布通过 `/clawd play` 单次播放：

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
| `/clawd play <名称>` | 播放任意一组官方动画，补全列出全部 25 组 |

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

- overlay 会覆盖编辑器最后两行的右侧 8 列：存在 `belowEditor` widget 时会压到 widget；自动补全或 `/` 菜单展开时右侧 8 列可能被遮住。
- 播放高画布动画期间，选中编辑器最后一行右侧有像素的格子可能复制出占位符字符；footer 两行的复制不受影响。
- 非 Kitty 终端没有 footer 显示（见上）。

## 开发

测试使用本机 Pi 的真实组件和 Jiti，不发起模型请求。

```bash
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run preview
```

当前 **81 个测试**通过，覆盖：全部 25 组素材的 base／delta 解码、15 组 footer 动画、8×4 舞台（占位符行号、体型不变性、边框掩码、overlay 生命周期）、Agent 状态转换、并行工具、偏好恢复、PNG／文本渲染、footer 尺寸与 fallback，以及 regular/fullscreen 两种真实渲染器上的选择与复制。

## 版权

非官方粉丝扩展，与 Anthropic 无官方关联；Claude、Clawd 名称和角色归 Anthropic。`assets/official-sprites.json` 包含从 Claude 6.6395.0 只读提取的官方 base＋delta 动画数据；MIT 只覆盖本项目原创代码。详见 [NOTICE](NOTICE) 与 [assets/README.md](assets/README.md)。