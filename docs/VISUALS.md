# 视觉与音乐分析

灯效渲染、运动与资源管理见下文；PCM、频段、门限和起音见 [音乐分析](#音乐分析)。

全部现有效果统一通过 React Three Fiber 9 渲染，保留 Three.js 自定义材质、实例化几何和 Rust 音频采集。React 负责视觉层的组合及生命周期，逐帧更新通过 `useFrame` 写入 GPU uniform，不逐帧更新 React state。

## 入口与组合

`src/features/spectrum/three/r3f/visual-scene.tsx` 是场景配方入口，所有视觉层共享 `CameraRig` 和 `SceneCompositor`：

```text
Rust PCM / FFT → AudioFeatureTimeline → SceneMotion
                                        ↓
VisualScene → CameraRig + 视觉层组合 → HDR / Bloom → 透明合成 / 遮罩
```

- `ClassicLayer` 挂载经典及自然意象效果的几何工厂，保留水母宽屏长焦等画面设计。
- `AmbientLayers` 组合花瓣或极光曲面、`ParticleField`、航道与飘带。`LightSurface` 封装透明混合、GPU 材质和资源所有权，可复用在其他配方中。
- 空间构图层组合潮汐之结、层海、回声廊道，与实验室复用同一场景实现。

层海的“占屏”在 50% 以上逐渐展开：相机提高俯视角度，固定粒子网格沿视锥投射到波面，使 100% 时波面越过画面四边。日常模式的缩小和下移随铺展进度收回；波面维持原有音乐高度与起音传播。窗口比例改变只更新相机和 uniform，不重建粒子缓冲区或着色器；`tests/expanse-fill.spec.ts` 检查三种比例、两种模式及强弱音下的四边可见性和 GPU 资源复用。

- `TerrainLayer` 通过实例化独立柱体呈现频谱山势，柱顶、侧面和间隙共同表现层次。每根柱体统一采样 GPU 高度预计算，保持平整柱顶及连续升降；高度公式与 CPU 参考保持一致，不逐格做 CPU 高度计算。均衡档使用 96 × 96 柱体，节能档 64 × 64，高画质档 128 × 128，多区域按预算缩减；窗口尺寸改变不重建柱体或着色器。
- `CameraRig` 统一保存的旋转、平移、滚转与缩放；`SceneCompositor` 统一曝光、HDR 降级、柔光、场景透明度、区域坐标和八个遮罩。

新增视觉层时，在 `VisualScene` 内组合组件，用 `useVisualFrame(runtime => { ... })` 读取帧数据。负优先级用于相机或 GPU 预计算，普通视觉层用 0，最终合成固定为 1。层不得创建第二个 WebGLRenderer、RAF 循环或私有音频分析器。

外部 DOM 宿主保留桌面窗口可见性、离屏休眠、帧率预算和键鼠操作，使用 R3F `frameloop: 'never'` 与 `advance(seconds)` 推进已接受的帧。这避免桌面层在工作台隐藏时被默认浏览器循环停掉，也保留静音后低频轮询恢复音频的行为。

每次 `root.configure()` 都必须显式传入 `frameloop: 'never'`，包括只更新尺寸或 DPR 时；省略该参数会恢复 R3F 的默认自动循环，与桌面调度重复绘制。运行时回归和多区域探针均检查手动推进次数与实际合成帧数一致。

`classic-renderer.ts`、`ambient-renderer.ts`、`terrain-renderer.ts` 仅作为现有截图脚本的兼容导出，均指向同一 R3F 实现。独立截图先 `await world.resize(config, regions)`，随后可同步调用 `draw` 和读取像素。测试的空白页面需使用 `scripts/visual-probe-html.mjs` 安装 React 的开发环境前导脚本。

## 参数、配色和音频映射

持久化外观仍沿用 `SpectrumSettings`、`MusicSettings` 及现有参数校验、检查器、区域隔离和场景导入导出，不更改保存格式。视觉层只读取参数；配色通过 `resolveEffectPalette` 获取 `low/main/accent/high` 语义颜色，不在效果内部另造固定调色板。

`VisualRuntime` 明确传递 `settings`、`motion`、`dt`、`reduced`、`regions`、`pointer`。`SceneMotion` 的输入与外观配置分开：

| 时间尺度 | 输入 | 建议用途 |
| --- | --- | --- |
| 快速冲击 | `frame.onset`、`frame.pulse`、`frame.beatStrength` | 短暂点亮、局部喷发；起音不是 BPM |
| 中速形变 | `volume`、`bass/middle/treble`、`frame.spectrum` | 曲面、地形、材质呼吸，频谱乘真实响度 |
| 缓慢运输 | `phase`、`auroraPhase` | 粒子行进、幕布折叠；静音停止，减少动态效果时冻结 |

`frame.intensitySample.current` 保留原始 RMS；自适应频段归一化只服务形状，不覆盖音量。不要把多次平滑、归一化后的频谱最大值重新当作音量。极光的细亮边现在使用局部频谱和短促冲击，广阔光幕仍按慢速运输推进，共享 Bloom 只扩散亮部。

## 音频时钟

Rust 每个 1024-sample FFT hop 都发送一帧，包含 `sourceRevision`、`streamId`、`sequence`、`samplePosition`、`sampleRate`。当前 PCM 是 48kHz，FFT 窗口 4096。`samplePosition` 是分析窗口末端的位置；重连会换 `streamId`，切换选择会换 `sourceRevision`。

`useSpectrum` 为每个订阅创建共享 `AudioFeatureTimeline`，按捕获帧更新源起音状态，拒绝重复、倒序、旧音源帧。分析时间来自 `samplePosition / sampleRate`，不将它直接与 `performance.now()` 比较；接收时刻只用于映射显示时钟和 350ms 失联判定。不同区域共享相同的起音序号，灵敏度和响应只改变外观映射。区域渲染消费每个起音一次，不重复消费同一音频帧。

频段显示按持续映射的采样时钟在历史帧之间插值，标称保留一个 hop 的余量；到达抖动不会重新锚定显示段或让时钟倒退。超过余量的延迟会等待捕获端点，因此不是一个 hop 的总延迟上限。瞬态事件不插值。失联后不继续外推声音，恢复或重连清空旧分析状态但保留空间路径。明确标记的模拟预览也按固定 1024/48000 时钟采样，不按显示刷新率生成分析帧。

连续运动的状态与回归约定见下节。

后续音乐回应修正将持续能量、频段和短时起音分别供给场景；长时间设备时钟漂移不会再把新起音提前衰减掉。常规外观仅保留空间、光感、音乐参与度三项主要偏好，数量、尺寸和方向位于“造型细节”。旧参数仍可载入，原始采集 RMS 和源端检测不变。

银河由球壳承载，星点和气体共用角坐标及旋转，避免显露矩形平面的斜切边。透明 HDR 曲面的法线/幂底范围与极光薄幕的边缘 UV 已限制，避免单个 NaN 经 Bloom 形成黑块；落雨的起音落点 GLSL 声明已补齐。定向回归见 `tests/hdr-surface-boundaries.spec.ts` 与 `tests/musical-scenes.spec.ts`。

## 质量与资源

`r3f/quality.ts` 决定几何密度、地形网格、MSAA 和 Bloom 层数；`three/render-budget.ts` 限制总像素；`render-budget.ts` 控制接受帧率。节能 / 均衡 / 流畅分别使用 1 / 2 / 3 层 Bloom、0 / 最多4 / 最多4 MSAA。增加区域时按区域数分配像素，按平方根降低几何密度，保留相同的场景层次和音频含义。

R3F 拥有一个画布的根和渲染器。组件拥有自己创建的材质、几何、纹理及离屏目标；工厂 `primitive` 通过 `disposeVisualTree` 显式释放，不能依赖 R3F 自动清理 primitive。共享曲面用 `dispose={null}`，由持有资源的组件统一释放。卸载同步提交清理，停止外部调度；根释放渲染器和 WebGL context。质量/密度变化替换视觉层资源，不新建 context。

## 连续运动与场景边界

`SceneMotion` 持有相位、惯性和路径；重复绘制、几何重建及外观修改不重播路径。源重连只重置音频历史。捕获时钟与本地时钟持续映射，按最近到达偏移修正长期漂移，事件时钟最多领先最新采样一个 hop，显示时钟保持单调。

`three/reactive-motion.ts` 的每效果状态只随接受的模拟步推进。形变及滞后形变使用有界指数响应；转角累积非负捕获冲击，冲击结束不倒转；最多保留八个真实起音波，允许前一波自然结束。没有周期时钟合成节拍。静音与减少动态停止运输，局部形变允许收束。水母与三套空间构图保留各自的运动系统，共享源分析。

效果造型与 ID 以 `music-engine/catalog.ts`、`effect-definitions.ts` 为准。新增自然场景包括蝶群、银杏、焦散与星脉；使用确定性种子、已有频段与起音，不增加私有分析器或远程贴图。地形 CPU/GPU 高度公式必须成对维护，局部响应和透明 HDR 材质需检查静音、侧视、低质量与资源释放。

水光焦散使用固定细分水面网格，在 GPU 上按波面梯度投射到水下，折叠部分以加色混合汇聚光能。强度取自连续插值曲率对应的投影面积变化，避免每个三角形独立计算屏幕导数产生亮度断层；低光部分的透明度随光强减弱，避免在桌面上出现黑色网格。窗口缩放只更新镜头和 uniform，网格细分随质量预算创建。

## 两种构图与歌词

融入桌面模式的可见性由 `r3f/desktop-visibility.ts` 调节。细粒子、透明水母及极光按效果提高覆盖率，实际发光片元周围增加 1–2 个渲染像素宽的暗色衬边，让亮点在浅色壁纸上也能辨认。此处理在共享合成 pass 中完成，不增加渲染目标或绘制次数；空白像素继续透明，最终统一应用不透明度、静音显隐及遮罩。

桌面中央不再叠加固定的 62% 透明衰减；留白由构图及真实歌词范围处理。`tests/desktop-visibility.spec.ts` 用浅色、深色和明暗交错背景检查细节对比，并检查遮罩、零不透明度、局部歌词避让与空场景透明性。`scripts/capture-desktop-visibility.mjs --label=<唯一名称>` 可生成全部 18 种效果的透明实渲截图，使用固定合成分析输入。

`CompositionLayout` 在保存的用户视角之上做屏幕相对布局：桌面模式按效果侧置、缩小，并柔和降低中心占用；沉浸模式保留完整空间，水母／丝绸／地形增加微小运镜。减少动态效果时运镜冻结。宽条带不应用侧置和中心淡化；点击射线会转换到构图本地坐标。

每个 `PreviewStage`、`DesktopOverlay` 独立拥有 `SceneFocusProvider`。歌词仅在有实际可读行时发布避让拾光绳之后的真实区域；拖动、缩放和避让都会更新。没有歌词、前奏、预览关闭或桌面不可用时移除发布者。多个预览之间不共享全局状态。

统一合成器在歌词背后局部柔化纹理、降低亮度与 Bloom；换句只轻微点亮该区域的既有表面。无声和减少动态效果时不触发换句微光。时间来自接受帧的 dt，同一音频帧重复绘制不重复推进微光。全局遮罩、唯一的色彩转换和预乘透明输出继续在最终合成阶段完成。

## 画面实验室

歌词灯光读取 `AnalysisSnapshot.timeline` 中现有的共享音频帧，不启动额外采集或节拍检测。低频起音轻推折幕和折痕，中频改变亮面延展，高频点亮细线；文字只绘制一份，逐字高亮仍按歌词时间轴推进。暂停、减少动态或采集过期时关闭音乐强调；只有明确的模拟预览使用合成输入。字体、构图与字号继续沿用用户设置。

折幕播放时提前分任务准备下一句的纹理，每个任务最多一个短语面板，换句和跳转目标立即补齐；只保留相邻三句，换歌、字体变更和离开预备范围时取消任务并释放资源。暂停后的已完成画面不因音频或歌词轮询继续重绘。相关回归：`tests/lyric-audio.spec.ts`、`tests/folded-production.spec.ts` 与 `tests/idle-rendering.spec.ts`。

启动开发服务后打开 `/tools/visual-lab.html`。选择效果、构图及片段，或载入主应用已保存的主区域参数，再生成画面、记录 A／B、拖动对比位置、保存透明 PNG。A／B 只保存在页面内存。此入口仅用于开发审阅。

输入是明确标注的原创**合成特征序列**，不播放或采集声音，也不代替 PCM 分析或真实音乐验收。序列按 48kHz／1024-sample 包时钟输入独立的 `AudioFeatureTimeline`，画面以固定 30Hz 从起点重放。包含低频鼓点、中频长音、高频、安静段、骤停、收束和完全静音七个采样时刻。

```powershell
# 默认三个代表效果 × 两种模式 × 七个时刻
npm run visual:compare -- --label=experiment-a
# 修改视觉后，复用上一轮完整外观和镜头配置
npm run visual:compare -- --label=experiment-b --baseline=experiment-a
# 全部效果，或指定效果；软件 WebGL 也可用于检查
npm run visual:compare -- --label=all-effects --all
npm run visual:compare -- --label=snow-check --effects=ripple --software
```

输出在忽略的 `artifacts/visual-studies/<label>/`：透明 PNG、本地 HTML 对比页和 `report.json`。报告包含完整设置、镜头、采样时刻、分辨率、GPU、像素 hash、覆盖率、中心覆盖率、平均光亮和卸载后的资源计数，以及代表效果的随机种子。相同机器与渲染器下可检查逐像素重现；不同 GPU 的像素 hash 不保证一致。已有报告不会被覆盖，重新运行请换 label。

自动检查包括参数沿旧 schema 往返、艺术控制与独立重置、确定性重放、模式中心占用、静音与减少动态效果、歌词区域外像素不变、换句重复帧稳定、独立 provider、实际歌词位置发布和资源释放。相关回归入口：

```powershell
npx playwright test tests/creative-scenes.spec.ts tests/classic-scenes.spec.ts tests/ambient-scenes.spec.ts tests/sound-field.spec.ts tests/effect-palette.spec.ts
npx playwright test tests/settings.spec.ts tests/scene-view.spec.ts tests/lyrics.spec.ts tests/idle-rendering.spec.ts tests/r3f-runtime.spec.ts tests/regions-masks.spec.ts tests/preview-arrangement.spec.ts tests/desktop-preview.spec.ts tests/desktop-recovery.spec.ts
npm run build
node scripts/visual-benchmark.mjs --width=3840 --height=2160 --quality=balanced --label=creative --lyrics
```

性能探针的 `--lyrics` 添加歌词位置与换句区域影响，不渲染文字本身；`--label` 避免覆盖旧探针。`--url=http://127.0.0.1:1422` 可让截图或性能脚本使用独立开发服务。同步等待 GPU 的耗时用于比较场景成本，不能当作应用 FPS。浏览器模拟输入、截图和自动测试不能替代真实音源、Tauri 原生桌面层、多屏和 macOS 实机验收。

## 窗口缩放与原生排查

场景首次绘制前等待异步 shader 准备，离屏各 pass 按自身目标编译。场景切换串行准备，关闭时等编译轮询结束再释放材质；尚未就绪的 draw 返回 false，宿主保留 dirty 状态以便静音时也会重试。纯尺寸变化复用上下文、材质和准备缓存，只应用最新尺寸。效果、质量、密度、区域数量或构图变化可要求重新准备。

工作台预览共享 1920×1080 像素预算。宿主 ResizeObserver 在 RAF 内合并测量；最大化状态 IPC 合并查询。标题栏最大化/还原先暂停 GPU 呈现并让出 32ms，尺寸安静 160ms 后调整缓冲区；期间动画与音频状态继续推进。恢复绘制还必须等待最后一次异步尺寸提交完成，不能仅凭安静计时器到期就先用旧缓冲区绘制；较早请求完成也不能解除较新请求的等待。恢复沿用原场景。

开发版 F8 打开本机诊断，观察 context、准备次数、program 数、缓冲区耗时、RAF 间隔及 long task；另显示原生窗口调用耗时、尺寸提交后的首帧 CPU 耗时、恢复等待和暂停状态。不上传、不持久化。准备次数增加需查场景重建；次数稳定而存在长任务需查同步工作或图形调用；RAF 长间隔但无对应长任务需继续检查 WebView2 调度和原生呈现。

`node scripts/measure-native-window-resize.mjs LABEL` 连接本机 9223 调试端口，通过真实标题栏按钮做两次最大化/还原，分别记录原生状态到达时间、RAF、长任务、实际缓冲区写入和新增编译数，结束恢复窗口状态并比对配置。支持打包调试页面和开发页面，报告位于 `artifacts/native-window-resize/`。`node scripts/check-live-scene-response.mjs LABEL` 使用当前配置的真实音频分析事件，在独立时间线和离屏生产场景中检查四种细节灯效；不控制音乐播放，不保存 PCM，不修改已保存配置。

**用户报告的原生最大化 2–3 秒停顿尚未确认解决。** 既有浏览器探针与原生截图只证实上下文/程序复用，并记录局部缩放开销，不能证明物理呈现已恢复。用 `scripts/measure-cold-scene-resize.mjs LABEL` 和 `scripts/measure-workspace-resize.mjs LABEL` 记录实际编译、RAF、上下文与 GPU 等待，结果写入 `artifacts/`；浏览器 viewport resize 不能替代原生窗口转换。

## 验证入口与证据边界

`node scripts/check-music-transitions.mjs LABEL` 将弱音、密集冲击、暂停、断包和换源连续送入全部 18 种生产场景，覆盖桌面与沉浸模式，报告及采样图位于 `artifacts/music-transitions/LABEL/`。可用 `--capture=PATH` 追加 `probe-musical-response-native.mjs` 生成的真实分析事件回放，保留原到达间隔、音量和频带，源版本仅为接在合成流之后而平移；不保存 PCM 或控制播放器。`SceneMotion.resetRevision` 让事件缓存识别时钟没有倒退的换源，清除旧鼓点并保留运动路径。

```powershell
npx playwright test tests/audio-timeline.spec.ts tests/r3f-runtime.spec.ts tests/scene-lifecycle.spec.ts tests/reactive-motion.spec.ts
npx playwright test tests/scene-preparation.spec.ts tests/scene-resize.spec.ts tests/composition-scenes.spec.ts tests/new-effect-families.spec.ts tests/material-scenes.spec.ts
node scripts/visual-probe.mjs --hardware
node scripts/visual-benchmark.mjs --width=3840 --height=2160 --quality=balanced
```

`/tools/composition-lab.html?scene=sculpture` 与 `scripts/capture-compositions.mjs` 审阅空间构图；`scripts/capture-effect-refinement.mjs`、`capture-effect-motion.mjs` 审阅实际生产造型与连续运动，输出均在 `artifacts/`。静态图之外应检查相位单调、重复帧不推进、30/60/120Hz 一致性、静音和减少动态、WebGL 错误与卸载资源。

截图和性能探针使用明确标注的合成音频，不作为真实音源证据。CPU 提交与同步等待 GPU 的耗时用于同机比较，不能直接视为应用 FPS；软件 WebGL 也不能代表用户显卡。原生桌面合成、采集端到端响应、多屏、休眠和 macOS 权限需对应平台实机验证。

依赖依据：[R3F 与 React 版本对应](https://r3f.docs.pmnd.rs/getting-started/introduction)、[外部根与手动帧循环](https://r3f.docs.pmnd.rs/api/canvas)、[useFrame 优先级与 advance](https://r3f.docs.pmnd.rs/api/hooks)。版本由 npm 锁文件固定。

## 音乐分析

显示时钟、包边界插值和场景运动见上文 [音频时钟](#音频时钟)。分析关注同强度音色的可比性、弱音连续性、真实强弱关系和起音的频率性格。原生采集仍在 Rust 完成；没有把 PCM 再送入 Web Audio 做第二次分析。

### 数据语义

| 字段 | 含义 |
| --- | --- |
| `rms` | 未加窗 PCM 的绝对 RMS，左右声道取较强者；不受灵敏度、显示压缩或门限影响 |
| `bandRms[6]` | 40–120、120–300、300–750、750–1800、1800–4500、4500–12000Hz 各范围的积分 RMS |
| `spectrumRms[48]` | 0–18000Hz 的 48 个非线性频段积分 RMS，连续边界可分割总功率 |
| `bands` / `spectrum` | 从上述物理量作固定显示压缩：`min(1, (rangeRms / 0.5)^0.4)`，没有频段专用艺术权重 |
| 驱动 `relativeLevels` | 约 4 秒窗口的局部相对变化，仅作为细节增强 |
| 驱动 `levels` | 绝对显示量经灵敏度曲线，再乘有界的相对细节因子并平滑；恒定 `.2/.4/.8` 不会再全部变成 `.5` |
| 驱动 `transients[3]` | <300、300–1800、>1800Hz 的起音包络，供冲击、形变和高频细节分别使用 |
| `period` / `beatIndex` | 检测到的起音间隔及事件序号；不表示经过验证的 BPM 或拍相位 |

4096 点 Hann 窗、48000Hz、1024 hop 保留。每个 FFT bin 的单边功率为 `|FFT|² * sides / (N * sum(window²))`，DC/Nyquist 的 `sides=1`，其他为 2。先在线性功率域按边界积分，再开方；不在 dB 显示量上求平均，也不除以频段宽度。此量等价于单边功率密度乘频率步长后积分，不应混称为密度。

每个范围分别取左右声道中较强的积分功率，保留原有反相与单侧输入的可见性。左右声道内容不同时，范围可以分别来自不同声道，因此频段功率之和**不宣称**等于较强声道的总 RMS²。单声道/同相信号的完整频率分割可用于功率守恒验证。窗口功率对平稳输入有明确归一化；瞬态窗口的加权频谱 RMS 与未加窗的矩形 RMS 可以不同。

96 格传统柱图保留原有密度显示标度，`skin` 保留原有 byte 标度；它们不作为新的物理频段 RMS。DSP 不再因视觉门限毁掉弱音特征。

### 门限与强弱

共用门限在采样时钟上运行：RMS ≥0.0015（约 -56.5dBFS）打开，低于 0.0008（约 -61.9dBFS）持续 100ms 才关闭。中间区间保持原状态，短断音不反复闪烁；后续可见性和形变使用各自的释放包络。区域参数变化重放的是已经判定的同一门限状态，不会各自改变全局起音。

原始 RMS 保持不变；没有持续增长的自动增益。灵敏度保留 0.5–2 的范围与原有平滑运动 `gain/2` 的尺度，作用于视觉强度和频段曲线。它不修改原始 RMS，也不降低物理门限。低于开启门限的微弱声音仍保留在原生物理特征中，但默认不启动画面。

场景整体可见度也表达绝对强弱：复用现有包络的 RMS 通道，将可见度乘以 `0.2 + 0.8 * sqrt(clamp(energy / 0.12))`。其中 `energy` 取平滑 RMS 与 `当前 RMS * clamp(pulse * 4)` 的较大值。后者只加快真实起音，不能把能量提高到当前 PCM RMS 以上；持续音仍走原有包络，没有再串联一层平滑。弱音保留克制的可见下限，静音释放到零；鼠标触摸保持独立。驱动字段 `displayPresence` 仍是门限包络，最终场景的 `SceneMotion.presence` 才包含这项强弱映射，两者不要混用。

固定门限不能区分同 RMS 的底噪和音乐。合成低噪声验证只能验证下限稳定性，不能代替真实声卡、系统音量、录音噪声与不同音乐的试听。持续高于门限的噪声仍可能显示，这不是噪声分类器。

### 起音与时间

起音使用细分频谱的正差分，以前一帧相邻频率的最大值作为参考，抑制小幅音高摆动。低、中、高区域分别维护因果阈值和重新准备状态；矩形 PCM RMS 的上升保留快速触发路径。新到达的功率决定区域支撑，持续响亮的低频不会直接盖掉新出现的轻微高频。整体衰减时，只有有足够新区域能量才允许触发，避免把硬断音的频谱扩散当作新起音。

同一事件在短时间内可以随着谱窗填满而增加包络强度，但不重复增加事件序号。起音去重为 65ms；持续音不会按估计间隔自动起拍。通用冲击对中、高频施加 0.65 / 0.3 的艺术权重，三个原始区域包络仍分别提供给效果。

共享时间线继续按每个捕获 hop 推进，参数缓存不拥有独立节拍。采样时钟断开后重置分析状态，350ms 没有新到达帧则停止消费；收到持续但延迟的包不因为 UI 抖动自行重置。无效采样时钟在消耗序号之前拒绝。场景睡眠恢复仅消费当前新鲜事件。

### 可重复验证

```powershell
node scripts/probe-music-analysis.mjs
node scripts/measure-music-analysis.mjs
node scripts/desktop.mjs --cargo test --manifest-path scripts/dsp-probe/Cargo.toml --target-dir artifacts/music-analysis/native-target
npx playwright test tests/music-analysis-native.spec.ts tests/audio-timeline.spec.ts tests/music-engine-contract.spec.ts
```

独立 Cargo 探针直接编译生产 `src-tauri/src/dsp.rs`，输出每个 hop；没有复制 DSP 公式来冒充原生执行。PCM 振荡器用 f64 生成后量化到 f32，避免高频长相位的 f32 运算误差干扰比较。输入包括等 RMS 不同频率、两窄带、宽带噪声、弱音、静音、低噪声、同相/反相/单侧输入、瞬态与结束、颤音、缓慢渐强、持续低音上的轻高频起音、同区域等能量换音和弱音短间隙。

生产与基线探针应使用不同的 Cargo package/bin 名称，避免共享 target 目录时覆盖可执行文件。可执行文件嵌入 DSP 源码指纹，JS 启动器与请求源文件核对，不一致则拒绝测量。

前后比较所需的旧源码、原始特征、截图、响应曲线与日志保存在本机忽略的 `artifacts/music-analysis/`。未保留基线时，只能验证当前实现，不能复现原来的版本比较；不要把历史通过数量写成当前验收结果。

像素响应按固定 PCM、种子、镜头和采样时间重放，记录起音和首次达到事件画面峰值 5% 的时刻。该模拟不包括系统采集、传输、调度、垂直同步与物理显示。85.3ms 窗长及各层平滑时间常数不能相加视作端到端延迟。

### 实机验证边界

到达偏移需随设备时钟漂移持续校正，事件时钟最多领先最新采样一个 hop；修正显示时钟不改变原生 RMS 与源端起音。真实音源听感、端到端响应、不同声卡/底噪与 macOS 行为仍需现场验证。

### 参考

- [SciPy periodogram：density/spectrum、单边功率及窗口缩放](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.periodogram.html)
- [librosa onset_strength：正谱通量及相邻频率最大参考](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_strength.html)
- [librosa 官方多区域起音实现和说明](https://librosa.org/doc/main/_modules/librosa/onset.html)

本实现参考这些定义进行工程取舍，不宣称复现完整 librosa 检测器，也没有新增人声、乐器或副歌识别。
