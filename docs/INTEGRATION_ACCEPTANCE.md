# 最终整合验收（2026-11-07）

本轮检查针对 R3F、视觉打磨与音乐分析合并后的当前工作区；不替代或改写 `VISUALS.md`、`VISUAL_STUDIES.md`、`MUSIC_ANALYSIS.md` 中的历史记录。未提交、推送、回滚或清理其他任务的修改。

## 修复与复现

实际 SettingsWorkspace 的媒体和状态轮询会触发 React 更新，PreviewStage 由同一组值构造新的区域 settings 对象。ThreeSceneCanvas 原先通过 `config !== next.settings` 设置 dirty，导致静音后仍周期性合成。

真实开发版修复前记录见 `artifacts/integration-final/idle-before-active.json`：有效断源区间约 4.8 秒，预览 `data-frames` 从 6527 增到 6539，RMS 和 ripples 都为 0；settings 引用改变而 JSON 值不变，focus revision 不变。其后用户恢复了音源，因此不能把整个文件作为持续断源观测。

新增 `tests/integrated-scene-idle.spec.ts` 使用实际应用入口、SettingsWorkspace/DesktopOverlay、真实轮询 hook、两个区域和连续原生分析事件。修复前两项都在静音轮询不应增加合成计数的断言失败，见 `idle-regression-before.log`。

修复在 React settings 更新时记忆有效视觉值签名：区域样式（含 music、view、bounds、atmosphere）、quality、masks；调度循环比较该签名，仍接收最新 settings。没有在每个 RAF 内序列化，也未修改音频算法或视觉方向。原有 resize、区域数量、模拟模式、休眠恢复、音源代际、歌词焦点及交互失效继续生效。

新增集成回归修复后 2/2 通过，覆盖：媒体轮询停绘、UI 不透明度编辑后再次停绘、嵌套 music/masks/view/bounds 更新、歌词焦点出现/换句/清除、持续真实分析恢复、释放后再次停绘。嵌套外部设置事件检查在实际订阅该事件的 overlay 上执行；工作台通过自身 UI 保存路径检查。

## 完整回归发现的 HDR 边界问题

第一轮完整 268 项回归得到 267 passed / 1 failed（28.0 分钟），唯一失败是现有 `retired-effects.spec.ts` 的 HDR/MSAA 有限值检查：水母 yaw=-65° 时出现 7 个负通道值，无 NaN 或 WebGL 错误。原始全量日志保存为 `browser-full-first.log`，失败 trace/截图在 `hdr-first-failure/`。这轮验证前后 361 个源码/测试/脚本等文件的指纹没有变化，见 `fingerprint-first-pass.json`。

隔离水母各材质读回后，7 个负值全部来自触须（50 实例），最小值为 -0.0298614501953125，包含负 alpha；其他四层没有负值。触须片元输出直接使用插值透明度，MSAA 边缘调用可外插到覆盖三角形以外。修复将进入加法混合的片元 alpha 限制为 0–1，保留原有几何、色彩、运动及灯光。相同探针修复后所有层的负值/非有限值均为 0；没有放宽原测试断言。证据为 `hdr-isolation-before.json` / `hdr-isolation-after.json` 及对应日志。

此修复后重新构建生产前端、嵌入该资源的 Windows 原生程序，并重新执行定向检查及真实开发版验收。第二轮完整浏览器回归已中止；按用户最新要求，后续仅验证出错点及直接关联场景，不再重复全套。

第二轮在 `star_flight` 断源检查中读到 707 个可见像素（预期 0）。失败 trace 显示页面发生第二次 Vite/React 启动，测试夹具已消失，截图回到默认水母模拟页面，因此该结果受到整页重载干扰，不能作为已确认的星际航行残留缺陷。具体重载触发原因尚未独立确认。原用例独立连续 8 次通过（1.2 分钟）；逐次绘制探针显示最后一帧 maxAlpha=0、visible=0，没有为此添加生产代码修复。证据见 `browser-full-second-interrupted.log`、`star-flight-failure/`、`expiry-repeat-before.log`、`expiry-before.json`。

最后 4 项定向验证使用独立端口 1421，关闭 HMR 与文件监听，包含 HDR/MSAA 原失败用例、星际航行断源、工作台及 overlay 停绘，4/4 通过（1.2 分钟）。首次启动仅因临时配置的工作目录导致服务脚本路径重复，测试尚未开始；修正临时配置后重跑。没有再次执行全套回归。

## 真实 Tauri 开发版

复用了 `src-tauri/target/debug/soundspectra.exe`（PID 35240），`application_info.development=true`。未启动旧安装版，未操作 QQ 音乐播放。

| 检查 | 结果 |
| --- | --- |
| 切换到未运行播放器，等待 9 秒释放后观测 | 最终代码复验约 6.5 秒内预览/overlay 合成增量均为 0，RMS/ripples 均为 0 |
| 恢复原自动音源 | 真实 QQ 音乐采集恢复，预览与 overlay 均重新渲染 |
| 从真实工作台 UI 切换水母、风织绸境、频谱回响 | 两处场景标识与渲染均更新，无 render-error |
| 工作台最小化 | 最终代码复验约 2.5 秒内预览增加 0 帧，overlay 增加 143 帧 |
| 原生桌面层级 | attached/betweenDesktopLayers/child/transparent/noActivate/visible 为 true，topmost 为 false，父层 Progman，桌面范围 2560×1440 |
| 配置恢复 | source/effect/music/color/followCover/灯效历史已恢复；恢复后完整 settings 与测试前相同，工作台已恢复非最小化 |

测试每 250ms 检查所拥有的音源及配置字段，若用户修改则中止；恢复前按字段比较测试写入值，只恢复仍匹配的字段。其余字段使用即时读取值保留。Tauri 当前更新接口为整份 settings，读取到提交之间没有跨进程原子 compare-and-set，不能保证消除这一极短窗口的并发竞争。

这些增量来自 `data-frames` 的实际合成次数；`data-frame-ms` 仅表示单次绘制耗时，不作为 FPS。断源/恢复、场景切换与最小化的帧计数观测均在完整浏览器 GPU 回归开始前完成；随后只读检查恢复状态及桌面层级。

完整证据：`artifacts/integration-final/native-report.json`、`native-acceptance.log`、`native-final-state.json`。截图：`native-disconnected.png`、`native-rhythm_balls.png`、`native-rhythm_skin.png`、`native-sound_field.png`、`native-overlay-while-minimized.png`、`native-restored-workspace.png`。

## 最终代码检查

| 检查 | 当前结果 |
| --- | --- |
| 完整浏览器回归 | 首轮 267 passed / 1 failed，唯一 HDR 失败已修复并定向通过；第二轮中止，最终代码未获得完整 268/268 结果 |
| HDR 修复后的定向回归 | 22 passed，覆盖经典场景、创作场景、两项集成停绘及 HDR/MSAA/透明背景 |
| 星际航行断源复验 | 同一用例连续 8 次通过，逐次绘制探针末帧透明且无可见像素 |
| 最后 4 项定向验证 | 4 passed（1.2 分钟），覆盖两个原失败点及两项停绘集成用例，见 `targeted-final.log` |
| 前端生产构建 | 通过；保留现有大 chunk 提示 |
| Rust fmt | 通过 |
| Rust test --locked | 85 passed，4 ignored，0 failed |
| 发布脚本测试 | 16 passed，0 failed |
| 版本一致性 | 通过，1.0.4 |
| Windows custom-protocol 原生构建 | 通过；HDR 修复后的前端资源已重新嵌入，输出 `src-tauri/target/integration/soundspectra.exe`，独立 profile 保留了运行中的开发版 |
| git diff --check | 通过，仅现有 CRLF/LF 提示 |

4 个忽略的 Rust 集成测试涉及公共更新服务、公共歌词服务、用户 QQ 音乐缓存，以及会刷新/排序桌面图标的 Explorer 集成；本轮未额外执行。未把它们计入已通过测试。

本轮未覆盖 macOS 实机、多显示器、系统睡眠唤醒和真实音频到屏幕的端到端延迟，也未把画面验证当成主观听感评价。完整浏览器回归使用软件 WebGL，不能据此推断用户显卡的 FPS。

日志均在 `artifacts/integration-final/`：`browser-full-first.log`、`browser-full-second-interrupted.log`、`post-hdr-targeted.log`、`expiry-repeat-before.log`、`targeted-final.log`、`frontend-build.log`、`native-checks.log`、`check-results.json`、`diff-check.log`。最终比较的 361 个源码/测试/脚本等文件指纹无变化，见 `fingerprint-comparison.json`；组合结果见 `summary.json`。
