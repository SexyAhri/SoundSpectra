# 开发与验证

## 环境与命令

Windows 原生端需要 Node.js 24（见 `.nvmrc`）、Rust stable MSVC、完整的 MSVC C++ 工具、Windows SDK 和 WebView2。Mac 需要 macOS 13+、Xcode command-line tools 和 Rust stable。使用 npm 与 Cargo 锁文件。

```powershell
npm ci
npm run desktop
```

`npm run dev` 在 `http://127.0.0.1:1420` 启动浏览器模拟预览，配置存入 localStorage；原生配置与之分离。`scripts/desktop.mjs` 仅为子进程设置 Rust / MSVC / SDK 环境。

```powershell
npm run version:check
npm run test:release
npm run build
npm run test:smoke
node scripts/desktop.mjs --cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
node scripts/desktop.mjs --cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`npm run test:smoke` 手动运行应用、工作区和歌词回归；`npm test` 手动运行完整前端回归集。云端浏览器测试仅在手动运行 Checks 并勾选 `full` 时执行，默认 CI 和自动发布均不运行浏览器测试。本地和手动 Windows CI 均使用稳定版 Chrome。前端测试采用软件 WebGL，不代表真实显卡性能；CI 对软件光栅化设置较长等待上限，断言与本地一致。安装包与签名配置见 [发布指南](RELEASING.md)。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `src/features/settings/` | 四类编辑入口、区域选择、检查器、全局底栏、保存队列 |
| `src/features/preview/` | 桌面预览、布置、遮罩、自动搭配与场景库 |
| `src/features/spectrum/model.ts`、`regions.ts` | 配置归一化、区域隔离与显示范围 |
| `src/features/spectrum/music-engine/` | RMS、六频段、48 格频谱、起音及共享参数 |
| `src/features/spectrum/three/` | 相机、视角、帧生命周期、预算与透明合成 |
| `three/classic/immersive/` | 经典场景实现，按原效果 ID 创建；包含兼容旧配置的隐藏场景 |
| `three/terrain/`、`three/ambient/` | 频谱地形、花瓣、极光与星尘 |
| `src/features/lyrics/` | 文字编排、逐字高亮、歌词位置与同步 |
| `src/features/desktop/`、`desktop-card/`、`wallpaper-depth/` | 桌面输出、音乐信息与壁纸视差 |
| `src/features/audio/`、`application/` | 音源、窗口、偏好、备份与更新 |
| `src-tauri/src/audio*.rs`、`dsp.rs` | 音源发现、进程树捕获、FFT 与分析事件 |
| `src-tauri/src/now_playing.rs`、`lyrics/`、`lyrics.rs` | Windows 媒体会话、缓存发现与联网歌词 |
| `src-tauri/src/desktop.rs` | 桌面挂载、鼠标穿透、几何与宿主恢复 |
| `src-tauri/src/settings.rs`、`application.rs` | 原生校验、持久化、导入导出与备份 |
| `src-tauri/src/platform/macos/`、`src-tauri/macos/` | Mac 音频、桌面、媒体信息、壁纸和 Swift 原生辅助程序 |

## 场景与区域约定

当前界面有 13 种可选灯效；熔金潮汐、水波纹、丹霞声谷只保留旧配置兼容。不要把底层 16 个效果 ID 的数量当作当前可选数量。

灯效共享 `musicDriver`、`musicEnvelope` 与 `SceneMotion`，不另造音频能量或节拍。真实分析数据超过 350ms 未更新时按静音处理；渐隐后停止重复绘制，隐藏、暂停或离开场景时释放相应资源。减少动态效果时关闭空间传播，同时保留静态音乐响应。

`three/view.ts` 定义每区域独立视角，`three/camera.ts` 供预览和桌面共用。拖动按帧合并后通过区域 patch、保存队列和原生 `update_settings` 持久化，再广播到桌面。失效的区域 ID 不能回退为主区域写入。

「全屏展示当前灯效」只作用于选中区域，应用整屏范围、默认视角、场景尺度、沉浸背景和不透明度。普通切换经典灯效保留区域布局。歌词、音乐卡片的位置独立于灯效区域，歌词的完整行为见 [歌词说明](LYRICS.md)。

三维渲染按质量档位和区域数量共享像素预算；均衡及以上采用最多 4 倍 MSAA，仍受设备像素比、画布尺寸与硬件支持限制。不要将这些设置描述为所有机器均能达到指定帧率。

## 验证入口

Mac 音频通过 ScreenCaptureKit 对预设播放器分别采样，再由共享选择器选择唯一音源，不混入系统其他声音。Swift 辅助程序只输出 PCM，未注册屏幕画面回调；退出主程序后自动结束。AppKit 桌面属性在主线程设置，正常模式位于壁纸和图标之间并穿透鼠标。

Mac 歌曲信息通过播放器的公开脚本接口读取。播放器没有脚本词典、没有时间线或未授权时明确报告不可用，不借用其他应用的歌曲。当前 Windows 实机记录不能作为 Mac 验收记录；Mac 编译、授权、播放器和双版本升级需独立验证。

| 变化 | 重点回归 |
| --- | --- |
| 工作台、独立编辑入口 | `tests/workspace-layout.spec.ts`、`tests/application.spec.ts` |
| 区域、视角、保存与遮罩 | `tests/regions-masks.spec.ts`、`tests/scene-view.spec.ts`、`tests/settings.spec.ts` |
| 场景、分析、资源释放 | `tests/music-engine-contract.spec.ts`、`tests/scene-lifecycle.spec.ts`、对应场景测试 |
| 歌词与音源 | `tests/lyrics.spec.ts`、`tests/audio-sources.spec.ts`、Rust `lyrics::tests` |
| 打包与版本 | `npm run test:release`、`npm run version:check`、原生构建 |

Windows 实机脚本位于 `scripts/native-*-smoke.mjs`。以进程环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` 启动待测客户端；脚本可能临时调整配置，运行前阅读恢复逻辑，不要同时编辑设置。报告写入忽略的 `artifacts/`。

已有 QQ 音乐与桌面层级的实机记录，以及歌词解析、目录记忆、查询竞争和请求取消的自动化回归。仍需逐项验证其他播放器、受保护内容、设备切换、Explorer 重启、休眠、多显示器 / DPI、长时间性能和真实签名升级。浏览器模拟、测试 IPC 和旧构建截图不能替代这些验收。

## 提交文件

应提交源码、锁文件、CI、构建脚本、测试与夹具、应用图标、场景封面、文档及精选展示素材。安装包、依赖、缓存、调试端口配置、报告、诊断、歌词缓存和签名私钥不提交。

```powershell
git status --short
git diff --check
git diff --cached --check
git status --ignored --short
```

`.gitignore` 不会自动移除已经暂存的文件。提交前检查暂存区内容与工作区一致；仓库早期暂存的快照可能缺少新模块。按实际提交范围更新暂存区，不要仅凭旧暂存状态提交。

## 展示素材

README 的素材位于 `docs/images/` 与 `docs/media/`，使用实际渲染器和原创示例歌词，全部标注为模拟展示。应用默认不读取这些展示文件。开发服务启动后可重拍：

```powershell
node scripts/capture-showcase.mjs
node scripts/capture-lyric-compositions.mjs
```

脚本先输出到 `artifacts/`，选定的图片与视频再放入文档目录。不要将整个产物目录解除忽略，也不要提交真实播放器缓存、商业歌词或私人壁纸。
