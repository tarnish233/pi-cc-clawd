# pi-cc-clawd

一只待在 **Pi footer 两行右侧**、会随 Agent 状态做小动作的 Clawd。

默认 **8 列 × 2 行**。待机时保持低打扰，生成、工具调用、完成、compact 和出错时播放对应的官方像素动画。不加卡片、背景、标题或任务状态文字，也不占用 prompt 输入框上方空间。

## 外观与布局

- 固定的 **24×16 原始像素基准**，缩小时不重新设计头身、手臂和腿的比例。
- **Rex、Kitty、Ghostty 等支持 Kitty 图像协议的终端：8 列 × 2 行**，透明 PNG 等比例缩小，保留清晰像素边缘。footer 使用 Unicode 图片占位符，两行文字都可正常选择、复制。
- 根据真实字符单元的像素尺寸生成 PNG；必要留白，不拉伸角色。
- 在你的 `pi-cc-extensions` 两行 footer 中，Clawd 横跨两行右侧的 8 列，**不增加第三行**。两行左侧分别预留空间，不遮住模型、目录或 Git 信息。
- 没有捕获到兼容的自定义 footer 时，使用 Pi 原生 `belowEditor` 组件兜底，尺寸为 **4 列 × 1 行**；不再装饰 prompt 输入框。
- 字符终端的兜底组件保留原始轮廓，不为强行塞进一行而压坏造型。
- 空闲时每隔约 **4.5–8 秒** 偶尔眨眼、张望或播放一组短动画；工作和工具状态使用官方 12fps 帧序列。
- 输入框、编辑器、原 footer 的模型／上下文／费用／目录／Git 等信息均不由本扩展重绘。

图片能力由 Pi 自动探测，不强制开启终端不支持的协议。窄终端中自动隐藏兜底组件；footer 文本过宽时优先压缩文本，不改变小图标比例。

## 动画与 Agent 状态

内置官方 **6.6395.0** 的 base＋delta 动画目录，全部 **25 组**都能按需解码、校验和生成 RGBA 帧。8×2 footer 第一版只启用源画布高度不超过 18 像素的 **15 组**，避免把主体缩得过小或让 footer 高度抖动。

| 状态 | 动画与播放方式 |
| --- | --- |
| Agent 生成中 | Desktop：开场后循环工作片段 |
| 工具执行中 | CrabWalking：循环；并行工具全部结束后才返回生成状态 |
| 完成 | DancingHappy：播放一次后回到待机 |
| compact | Meditating：循环 |
| 出错 | Facepalm：播放一次后恢复当前状态 |
| 空闲 | 原生眨眼／张望，以及随机 Core 小动作 |

这些状态直接来自 Pi 的 `agent_start`、`agent_settled`、`tool_execution_*`、`turn_end` 和 compact 事件，**不让模型判断动画状态，也不产生额外模型请求**。

可手动播放的 15 组为：`CrabWalking`、`DancingHappy`、`Desktop`、`Disappointed`、`Dizzy`、`Excited`、`Facepalm`、`Hula`、`LookingAround`、`LookingAroundEyesOnly`、`Meditating`、`Running`、`Swaying`、`Turning`、`Walking`。

`BreakDancing`、`Confetti`、`Jumping`、`JumpingHappy`、`Laptop`、`Lightbulb`、`Pointing`、`Spark`、`Thinking`、`Waving` 因画布超过 18 像素而在本版跳过；它们仍可被解码层读取，但不会被 8×2 footer 或 `/clawd play` 显示。

播放使用一个可取消定时器，不为每一帧建立独立循环。`/clawd pause` 会停止自动状态动画；暂停期间仍可手动播放一次，结束后保持暂停。`/clawd off`、reload 和会话退出会取消帧计时器。

## 安装与加载顺序

需要 **Pi 1.5.2 或更新版本**、Node.js 22.19 或更新版本；运行时无额外依赖。

从 npm 安装：

```bash
pi install npm:pi-cc-clawd
```

固定到本次发布版本：

```bash
pi install npm:pi-cc-clawd@0.4.1
```

也可以从 GitHub 安装：

```bash
pi install git:github.com/tarnish233/pi-cc-clawd@v0.4.1
```

为了复用 `pi-cc-extensions` 的 footer，本扩展需要**先于它注册**。安装后检查 `~/.pi/agent/settings.json`，将本扩展放在 `pi-cc-extensions` 前面：

```json
{
  "packages": [
    "/absolute/path/to/pi-cc-clawd",
    "npm:pi-web-access",
    "npm:pi-cc-extensions"
  ]
}
```

这里只表示顺序，已有的其他 package 保持不变。也可以使用 `pi install /absolute/path/to/pi-cc-clawd`，然后检查 `~/.pi/agent/settings.json` 中的顺序。

**只保留一种安装来源**，不要同时使用软链接、package 安装和 `-e`，避免两个实例同时装饰 footer。修改后在 Pi 中执行 `/reload`。

临时试用：

```bash
pi -e ./pi-cc-clawd -e npm:pi-cc-extensions
```

`-e` 按给定顺序加载。若另一个 footer 在本扩展之前已经完成注册，则本扩展不会强行替换它，而是走原生 `belowEditor` 兜底。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/clawd` | 显示／隐藏 |
| `/clawd on` | 显示 |
| `/clawd off` | 隐藏并停止动画计时器 |
| `/clawd pause` | 保持站立，停止自动动作 |
| `/clawd resume` | 显示并恢复当前 Agent 状态对应的动画 |
| `/clawd blink` | 眨眼一次；暂停状态下也可用 |
| `/clawd play <名称>` | 播放一次上述 15 组之一，例如 `/clawd play DancingHappy`；暂停状态下也可用 |

显示和动画偏好作为本会话的扩展条目保存，`/reload` 或恢复该会话后保留。新会话默认显示并启用轻量动画；`/tree` 根据当前分支恢复偏好。

这些命令不调用模型、不发送聊天消息，也不消耗 token。开关不会重建编辑器或清除输入草稿、撤销记录和历史。

## 与现有 footer 共存

Pi 没有 footer getter，且 `pi-cc-extensions` 的 `setStatus` 通道会处理颜色、剥离终端序列，不能把图片协议直接塞进去。因此本扩展采用以下方式：

1. 在 `session_start` 阶段包装 `ctx.ui.setFooter`，等待后注册的自定义 footer 工厂。
2. 用保留的 key 向 `footerData` 提供一个不对外显示的占位符。
3. 在实际 footer 组件的渲染结果中，只替换**第二行**的占位符，并按图片的真实物理宽度右对齐。
4. 两行只在右侧预留图片区域，左侧原文和第三行不改；不替换 footer 工厂，不读取或修改 `pi-cc-extensions` 的配置文件。
5. 所有 `session_start` 完成后才启动轻量动画；隐藏时移除占位和图像，reload／退出时恢复原始 `setFooter` 并清理计时器。

原生 footer 把扩展状态放在第三行，不会误当成兼容的两行 footer。其他自定义 footer 只有在第二行提供对应占位时才会被装饰，避免覆盖第三方布局。

- 不调用 `setEditorComponent()`，不修改 prompt 编辑器、补全、快捷键或输入历史。
- footer 图片数据在渲染文本之外传输，两行只包含普通文字和 Unicode 图片占位符；相同帧不会因 footer 文字刷新而删除、重传，全屏重绘后会恢复图像数据。
- 4×1 `belowEditor` 兜底继续使用 Pi 原生 `Image` 组件，不改变其布局或鼠标坐标。
- TUI 模式才建立界面和计时器；RPC、JSON 和 print 模式不渲染、不启动后台资源。
- 一次最多一个可取消且 `unref()` 的定时器；动作共用一个图像 ID，只在帧、动作或字号变化时更新数据。
- 官方帧按需解码和缓存；PNG 在内存中生成，无网络请求，也不读取本机 Claude 安装包。

## 开发与验证

测试使用本机 Pi 的真实组件和 Jiti，不启动模型请求。可通过 `PI_CC_CLAWD_HOST_NODE_MODULES` 指定 Pi 安装目录。

```bash
npm test
npm install --legacy-peer-deps
npm run typecheck
npm run preview
```

没有在本项目安装 TypeScript 时，也可以复用本机编译器：

```bash
PI_TYPESCRIPT_PATH=/path/to/typescript/lib/typescript.js npm run typecheck
```

测试覆盖全部 25 组官方素材的 base／delta 解码、15 组 footer 动画、Agent 状态转换、并行工具、暂停恢复、手动播放、RGBA PNG／字符渲染，以及 footer 的固定 8×2 尺寸、4×1 原生 fallback、图像缓存、偏好恢复和定时器清理。另有普通 footer 更新不删图、全屏重绘恢复、真实 fullscreen 鼠标选择与复制测试。

本机存在 `pi-cc-extensions` 时，还会直接加载其真实 footer 组件验证两行内容保留和图片接入；不会修改该包或其配置。

## 版权与说明

这是非官方的粉丝扩展，与 Anthropic 无官方关联。角色设计、Claude 与 Clawd 名称归 Anthropic。

角色轮廓按原始像素基准表达，渲染、解码和状态播放逻辑在本项目实现，PNG 在内存中生成。`assets/official-sprites.json` 包含从 Claude 6.6395.0 只读提取的官方 base＋delta 动画目录，不包含 GIF 或栅格化动画包。MIT 许可只覆盖本项目原创代码，不覆盖 Anthropic 的商标、角色权利或官方动画数据。详见 [NOTICE](NOTICE) 与 [assets/README.md](assets/README.md)。
