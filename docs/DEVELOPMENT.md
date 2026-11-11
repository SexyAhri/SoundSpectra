# 开发与验证

## 环境与命令

Windows 原生端需要 Node.js 24（见 `.nvmrc`）、Rust stable MSVC、完整的 MSVC C++ 工具、Windows SDK 和 WebView2。Mac 需要 macOS 13+、Xcode command-line tools 和 Rust stable。使用 npm 与 Cargo 锁文件。

```powershell
npm ci
npm run desktop
```

`npm run dev` 在 `http://127.0.0.1:1420` 启动浏览器模拟预览，配置存入 localStorage；原生配置与之分离。`scripts/desktop.mjs` 仅为子进程设置 Rust / MSVC / SDK 环境。

推送前在本机运行全量检查：

```powershell
npm run check:full
```

该命令按 GitHub Checks 勾选 `full` 时的顺序执行：`npm ci`、版本一致性、发布脚本测试、前端构建、Chrome 准备、全部浏览器回归、Rustfmt、完整 Rust 测试和启用 `custom-protocol` 的原生构建。使用与 Checks 相同的 `CI=true` 超时和单任务 Cargo 构建；首次失败即停止，修复后重新运行。运行前关闭本项目正在使用 `node_modules` 的开发服务，避免 Windows 下依赖重装时文件占用。检查只验证本机平台，不生成安装包、不推送、不发布；Windows 本机不能代替 macOS 构建和实机验收。GitHub 自动发布继续使用现有精简流程，本机全量检查不会给线上增加自动步骤。

```powershell
npm run version:check
npm run test:release
npm run build
npm run test:smoke
node scripts/desktop.mjs --cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
node scripts/desktop.mjs --cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`npm run test:smoke` 手动运行应用、工作区和歌词回归；`npm test` 手动运行完整前端回归集。Checks 仅由手动操作或显式工作流调用触发，不随分支推送自动执行；勾选 `full` 时追加浏览器回归。自动发布仅执行构建与发布必需步骤，不运行 Rust 格式、单元测试、发布脚本测试或浏览器回归，前端由 Tauri 构建钩子执行一次构建。本地和手动 Windows CI 均使用稳定版 Chrome。前端测试采用软件 WebGL，不代表真实显卡性能；CI 对软件光栅化设置较长等待上限，断言与本地一致。安装包与签名配置见 [发布指南](RELEASING.md)。

浏览器回归默认使用 1420 端口，可通过 `PLAYWRIGHT_PORT` 为独立检出指定其他端口。设置 `CI=true` 时必须启动本次检查自己的服务；端口已占用会直接报错，避免误用其他开发窗口的页面。工作台冻结构建检查 `npm run test:ui` 默认使用 1422 / 1423 端口，分别可通过 `PLAYWRIGHT_UI_PORT` / `PLAYWRIGHT_FIXTURES_PORT` 调整，也遵守此规则。

## 模块边界

主工作台的启动层由 `src/features/application/startup-screen.tsx` 管理，与设置、音乐初始化并行运行。Canvas 声波从展开、流动到汇聚成标志，名称随后显现，标志与回声持续运动。开场至少显示 4000ms，就绪后用 600ms 淡出；初始化超过 8000ms 时自动开始退场，跳过立即释放工作台交互。画布随卸载停止绘制，不创建音频或 WebGL 资源。桌面叠加、音乐播放器和拾光绳独立窗口不显示启动层。

启动层完全遮盖工作台时，预览场景停止绘制，拾光绳、歌词与壁纸等预览暂停逐帧更新；淡出开始时恢复，在遮罩消失前预热画面。系统壁纸预览保留 WebP 质量与数据格式，使用异步编码，避免同步编码阻塞开场。声波共享固定采样包络与渐变，窗口隐藏时停止动画帧调度。

应用动画不读取系统动态效果偏好。界面过渡、歌词跟随、灯效预览、壁纸视差、封面配色和拾光绳始终使用完整动画；功能自身的暂停、静音、隐藏和性能档位仍控制对应生命周期。回归应模拟两种系统偏好并验证行为一致。

音乐平台接入、凭据与内置播放边界见 [音乐模块](MUSIC.md)。

| 模块                                                         | 职责                                                |
| ------------------------------------------------------------ | --------------------------------------------------- |
| `src/features/settings/`                                     | 氛围首页、模块导航、区域选择、检查器、全局底栏、保存队列 |
| `src/features/preview/`                                      | 桌面预览、布置、遮罩、自动搭配与场景库              |
| `src/features/spectrum/model.ts`、`regions.ts`               | 配置归一化、区域隔离与显示范围                      |
| `src/features/spectrum/music-engine/`                        | RMS、六频段、48 格频谱、起音及共享参数              |
| `src/features/spectrum/three/`                               | 相机、视角、帧生命周期、预算与透明合成              |
| `three/classic/immersive/`                                   | 经典及自然意象场景的渲染实现                        |
| `three/terrain/`、`three/ambient/`、`three/compositions/`    | 频谱地形、氛围层与空间构图                          |
| `src/features/performance/`                                  | 歌曲时间编排、转场、音乐映射与临时演出覆盖          |
| `src/features/lyrics/`                                       | 文字编排、逐字高亮、歌词位置与同步                  |
| `src/features/desktop/`、`desktop-card/`、`wallpaper-depth/` | 桌面输出、音乐信息、静态壁纸、音乐微光与视差        |
| `src/features/audio/`、`application/`                        | 音源、窗口、偏好、备份与更新                        |
| `src-tauri/src/audio*.rs`、`dsp.rs`                          | 音源发现、进程树捕获、FFT 与分析事件                |
| `src-tauri/src/now_playing.rs`、`lyrics/`、`lyrics.rs`       | Windows 媒体会话、缓存发现与联网歌词                |
| `src-tauri/src/desktop.rs`                                   | 桌面挂载、鼠标穿透、几何与宿主恢复                  |
| `src-tauri/src/settings.rs`、`application.rs`                | 原生校验、持久化、导入导出与备份                    |
| `src-tauri/src/platform/macos/`、`src-tauri/macos/`          | Mac 音频、桌面、媒体信息、壁纸和 Swift 原生辅助程序 |

## 场景与区域约定

灯效清单以 `music-engine/catalog.ts` 为准，当前有 18 种。晶簇声境、日冕回响、熔金潮汐、水波纹和丹霞声谷的实现、参数与缩略图已删除；仅在配置读取时将旧 ID 迁移到现有灯效。

灯效共享 `musicDriver`、`musicEnvelope` 与 `SceneMotion`，不另造音频能量或节拍。真实分析数据超过 350ms 未更新时按静音处理；渐隐后停止重复绘制，隐藏、暂停或离开场景时释放相应资源。空间传播随音乐推进，并遵循用户选择的性能档位。

歌词暂停后停止帧循环；相同播放时间和外观不重复绘制，暂停中的跳转、外观与尺寸变更仍立即更新。隐藏的预览暂停歌词绘制，恢复时读取当前播放位置；嵌入桌面的窗口不依赖 `document.hidden` 判断可见性。音量表静音收敛后停止重复写入 SVG 属性，以低频轮询检查新音频，具体间隔由模块预算决定。

`three/view.ts` 定义每区域独立视角，`three/camera.ts` 供预览和桌面共用。拖动按帧合并后通过区域 patch、保存队列和原生 `update_settings` 持久化，再广播到桌面。失效的区域 ID 不能回退为主区域写入。

「全屏展示当前灯效」只作用于选中区域，应用整屏范围、默认视角、场景尺度、沉浸背景和不透明度。普通切换经典灯效保留区域布局。歌词、音乐卡片的位置独立于灯效区域，歌词的完整行为见 [歌词说明](LYRICS.md)。

三维渲染按质量档位和区域数量共享像素预算；均衡及以上采用最多 4 倍 MSAA，仍受设备像素比、画布尺寸与硬件支持限制。不要将这些设置描述为所有机器均能达到指定帧率。

视觉效果已统一到 React Three Fiber。组件组合、音频采样时钟、外观映射、质量档位及资源所有权见 [视觉开发](VISUALS.md)。

## 验证入口

配置中的启动窗口设置 `create: false`，由原生 `setup` 在应用、拾光绳和托盘状态注册后创建；不要恢复为自动创建，否则首次 `get_settings` 或 `rail_get` 可能早于对应状态就绪。开机自启时主窗口从创建开始保持隐藏。`native-card-save-smoke.mjs` 同时验证首次启动和启用卡片后的重启能够直接载入设置，不出现恢复默认设置入口。

登录页展示图可通过 `node scripts/capture-project.mjs` 重新生成：先启动 `npm run dev`，或用 `SHOWCASE_URL` 指向已有开发服务器。脚本使用隔离浏览器与公开的平台能力配置，输出 `docs/images/music-login.png`；工作台模拟截图仅写入忽略的 `artifacts/workspace-simulation.png`，避免覆盖作者原图。脚本不读取本机登录凭据或修改桌面客户端设置。

README 的工作台、秋光银杏参数、音乐卡片、五张桌面全景与音乐库播放图保留作者提供的原图。其余模块应在本地 main 的开发客户端中截图：灯效选择、歌词、演出编排、桌面布置、壁纸和拾光绳。截图后恢复原页面；独立预演临时使用的原创示例也应清理，保持原有场景与演出配置。检查实际画面后同步 README 的日期与来源，不用模拟截图替换作者素材。

Mac 音频通过 ScreenCaptureKit 对预设播放器分别采样，再由共享选择器选择唯一音源，不混入系统其他声音。Swift 辅助程序只输出 PCM，未注册屏幕画面回调；退出主程序后自动结束。AppKit 桌面属性在主线程设置，正常模式位于壁纸和图标之间并穿透鼠标。

Mac 歌曲信息通过播放器的公开脚本接口读取。播放器没有脚本词典、没有时间线或未授权时明确报告不可用，不借用其他应用的歌曲。当前 Windows 实机记录不能作为 Mac 验收记录；Mac 编译、授权、播放器和双版本升级需独立验证。

| 变化                       | 重点回归                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 工作台、独立编辑入口       | `tests/workspace-layout.spec.ts`、`tests/application.spec.ts`                                                        |
| 区域、视角、保存与遮罩     | `tests/regions-masks.spec.ts`、`tests/scene-view.spec.ts`、`tests/settings.spec.ts`                                  |
| 场景、分析、资源释放       | `tests/music-engine-contract.spec.ts`、`tests/scene-lifecycle.spec.ts`、对应场景测试                                 |
| 歌词与音源                 | `tests/lyrics.spec.ts`、`tests/audio-sources.spec.ts`、Rust `lyrics::tests`                                          |
| 静音、暂停与窗口恢复       | `tests/idle-rendering.spec.ts`、`tests/desktop-recovery.spec.ts`                                                     |
| 拾光绳打开、排序与状态恢复 | `tests/rail-recovery.spec.ts`、`tests/rail-order.spec.ts`、`tests/rail-input.spec.ts`、`tests/rail-transfer.spec.ts` |
| 打包与版本                 | `npm run test:release`、`npm run version:check`、原生构建                                                            |

Windows 实机脚本位于 `scripts/native-*-smoke.mjs`。以进程环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` 启动待测客户端；脚本可能临时调整配置，运行前阅读恢复逻辑，不要同时编辑设置。报告写入忽略的 `artifacts/`。

音乐卡片保存与死锁回归使用 `node scripts/native-card-save-smoke.mjs <隔离调试版.exe>`：待测构建启用 `custom-protocol`，通过 `TAURI_CONFIG` 将 identifier 设为 `com.soundspectra.card-save-regression`。脚本在独立配置下启动自己的实例与 WebView2 调试端口（默认 9247，可用 `CARD_SAVE_TEST_PORT` 调整），验证首次创建、并发保存与备份/音源切换、场景应用、启用卡片后重启和桌面显隐，不操作现有客户端。Windows 的 WebView2 窗口创建必须在工作线程进行；持有设置事务锁时，界面线程也不能同步等待该锁，否则会与窗口创建相互等待。

Windows 外部文件和开始菜单应用统一通过原生 OLE 接收；DOM File-object 桥仅保留对渲染器内 File 对象的处理。桥的来源地址使用 `tauri::is_dev()` 区分开发服务器和安装版，不能用项目自身的 `cfg!(feature = "custom-protocol")` 判断，因为 Tauri CLI 直接启用依赖特性 `tauri/custom-protocol`。定向回归需同时覆盖默认特性和 `--features tauri/custom-protocol`，无需运行全量检查。挂载公共桌面项目时，独立的图标属性权限助手可能触发 UAC 确认。

Windows 设置页、拾光绳和弹窗创建时禁用 Wry 默认拖放，再通过 `SetAllowExternalDrop(false)` 关闭 WebView2 外部拖放。外部左键按下后移到应用窗口时，在 WebView 上方显示按目标窗口形状裁剪的临时原生接收窗，直接接收 OLE 数据；内部点击、排序和拖出不启用接收层，离开、取消或投递后隐藏。只在窗口所属进程和 UI 线程注册，禁止替换 WebView2 渲染/GPU 进程子窗口的拖放目标；跨进程注册返回成功不能证明实际拖放安全。AppsFolder 应用的 PIDL 仅在松开且允许复制或链接时保存到 `rail-apps`，悬停、取消和仅允许移动的拖放不写文件。`debug_rail_drop_state` 提供接收层状态与最近的拖入、解析、投递记录。回归覆盖原生窗口命中、真实 Shell 应用数据、快捷方式目标保留、拒绝跨进程目标且保持原注册不变，以及文件/文件夹/图片数据接收；开始菜单实际鼠标拖动仍需 Windows 实机验收，不能以注册状态或直接调用接收器代替。

Windows 应用挂件由 `rail/app_window.rs` 在工作线程读取 Shell 标识并枚举用户窗口，优先激活已有窗口。回归覆盖完整路径与 AppUserModelID 匹配、同名程序隔离、启动器目标、带参数快捷方式的原样启动、AppsFolder 快捷方式身份和最小化/隐藏/工具窗口筛选。真实前台切换还需在隔离原生实例中检查；不能以窗口枚举成功代替焦点切换验收。

自动化回归覆盖歌词解析、目录记忆、查询竞争和请求取消。播放器兼容、受保护内容、设备切换、Explorer 重启、休眠、多显示器 / DPI、长期运行和签名升级需按当前构建实测。

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

README 的素材位于 `docs/images/` 与 `docs/media/`。图片来源以 README 的展示说明为准；歌词演示视频使用模拟输入和原创示例文字。应用默认不读取这些展示文件。需要生成模拟展示素材时，可在开发服务启动后运行：

```powershell
node scripts/capture-showcase.mjs
node scripts/capture-lyric-compositions.mjs
```

脚本先输出到 `artifacts/`，选定的图片与视频再放入文档目录。不要将整个产物目录解除忽略，也不要提交真实播放器缓存、商业歌词或私人壁纸。

## 文档入口与维护

| 文档                           | 内容                                      |
| ------------------------------ | ----------------------------------------- |
| [开发与验证](DEVELOPMENT.md)   | 环境、命令、模块边界与验证入口            |
| [发布](RELEASING.md)           | 版本、签名、双平台构建与升级              |
| [视觉与音乐分析](VISUALS.md)   | 渲染、连续运动、PCM、频段、起音与缩放排查 |
| [桌面功能与工作台](DESKTOP.md) | 编辑、主题、音乐卡片、壁纸与拾光绳        |
| [歌词](LYRICS.md)              | 歌词获取、缓存、播放器兼容与同步时钟      |
| [演出编排](PERFORMANCE.md)     | 时间编排、转场、映射及状态恢复            |

同一模块的设计、行为与验证入口直接更新对应文档，使用当前行为描述，避免反复追加修改过程。不保留独立验收文档或阶段通过记录；脚本日志、截图和性能采样输出到本机忽略的 `artifacts/`。文档中的 `artifacts/` 路径表示脚本输出位置，需要运行后生成。精选展示素材仍按上节规则维护。源码、实验页、验证脚本、字体引用和许可证应正常提交。

## 开发优先级与待验证事项

稳定和低打扰优先于继续扩展：暂停或断源后安静、切歌同步准确、重启恢复布局、Explorer 重启恢复挂载，以及真实设备长时间资源占用。

拾光绳先守住挂载、打开、排序和恢复。保存失败保留原状态；失效路径可修复；正常退出恢复桌面项目。文件管理、在线作品库和完整搭配分享暂不作为当前阶段必需范围。现有场景交换范围以实际 schema 和界面说明为准，不携带私人文件、歌词缓存或壁纸图片。

窗口缩放的诊断方式见 [窗口缩放与原生排查](VISUALS.md#窗口缩放与原生排查)。其他播放器、macOS、真实多屏/DPI、休眠、长时间性能和签名升级需对应平台验证。
