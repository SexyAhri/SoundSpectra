# 视觉开发

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

- `TerrainLayer` 复用共享地形网格与 GPU 高度预计算，绘制连续山脊曲面及细节；高度公式与 CPU 参考保持一致，不逐格做 CPU 高度计算。
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

## 两种构图与歌词

融入桌面模式的可见性由 `r3f/desktop-visibility.ts` 调节。细粒子、透明水母及极光按效果提高覆盖率，实际发光片元周围增加 1–2 个渲染像素宽的暗色衬边，让亮点在浅色壁纸上也能辨认。此处理在共享合成 pass 中完成，不增加渲染目标或绘制次数；空白像素继续透明，最终统一应用不透明度、静音显隐及遮罩。

桌面中央不再叠加固定的 62% 透明衰减；留白由构图及真实歌词范围处理。`tests/desktop-visibility.spec.ts` 用浅色、深色和明暗交错背景检查细节对比，并检查遮罩、零不透明度、局部歌词避让与空场景透明性。`scripts/capture-desktop-visibility.mjs --label=<唯一名称>` 可生成全部 18 种效果的透明实渲截图，使用固定合成分析输入。

`CompositionLayout` 在保存的用户视角之上做屏幕相对布局：桌面模式按效果侧置、缩小，并柔和降低中心占用；沉浸模式保留完整空间，水母／丝绸／地形增加微小运镜。减少动态效果时运镜冻结。宽条带不应用侧置和中心淡化；点击射线会转换到构图本地坐标。

每个 `PreviewStage`、`DesktopOverlay` 独立拥有 `SceneFocusProvider`。歌词仅在有实际可读行时发布避让拾光绳之后的真实区域；拖动、缩放和避让都会更新。没有歌词、前奏、预览关闭或桌面不可用时移除发布者。多个预览之间不共享全局状态。

统一合成器在歌词背后局部柔化纹理、降低亮度与 Bloom；换句只轻微点亮该区域的既有表面。无声和减少动态效果时不触发换句微光。时间来自接受帧的 dt，同一音频帧重复绘制不重复推进微光。全局遮罩、唯一的色彩转换和预乘透明输出继续在最终合成阶段完成。

## 画面实验室

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

工作台预览共享 1920×1080 像素预算。宿主 ResizeObserver 在 RAF 内合并测量；最大化状态 IPC 合并查询。标题栏最大化/还原先暂停 GPU 呈现并让出 32ms，尺寸安静 160ms 后调整缓冲区；期间动画与音频状态继续推进，恢复沿用原场景。该调度仍需原生实测。

开发版 F8 打开本机诊断，观察 context、准备次数、program 数、缓冲区耗时、RAF 间隔及 long task；不上传、不持久化。准备次数增加需查场景重建；次数稳定而存在长任务需查同步工作或图形调用；RAF 长间隔但无对应长任务需继续检查 WebView2 调度和原生呈现。

**用户报告的原生最大化 2–3 秒停顿尚未确认解决。** 既有浏览器探针与原生截图只证实上下文/程序复用，并记录局部缩放开销，不能证明物理呈现已恢复。用 `scripts/measure-cold-scene-resize.mjs LABEL` 和 `scripts/measure-workspace-resize.mjs LABEL` 记录实际编译、RAF、上下文与 GPU 等待，结果写入 `artifacts/`；浏览器 viewport resize 不能替代原生窗口转换。

## 验证入口与证据边界

```powershell
npx playwright test tests/audio-timeline.spec.ts tests/r3f-runtime.spec.ts tests/scene-lifecycle.spec.ts tests/reactive-motion.spec.ts
npx playwright test tests/scene-preparation.spec.ts tests/scene-resize.spec.ts tests/composition-scenes.spec.ts tests/new-effect-families.spec.ts tests/material-scenes.spec.ts
node scripts/visual-probe.mjs --hardware
node scripts/visual-benchmark.mjs --width=3840 --height=2160 --quality=balanced
```

`/tools/composition-lab.html?scene=sculpture` 与 `scripts/capture-compositions.mjs` 审阅空间构图；`scripts/capture-effect-refinement.mjs`、`capture-effect-motion.mjs` 审阅实际生产造型与连续运动，输出均在 `artifacts/`。静态图之外应检查相位单调、重复帧不推进、30/60/120Hz 一致性、静音和减少动态、WebGL 错误与卸载资源。

截图和性能探针使用明确标注的合成音频，不作为真实音源证据。CPU 提交与同步等待 GPU 的耗时用于同机比较，不能直接视为应用 FPS；软件 WebGL 也不能代表用户显卡。原生桌面合成、采集端到端响应、多屏、休眠和 macOS 权限需对应平台实机验证。

依赖依据：[R3F 与 React 版本对应](https://r3f.docs.pmnd.rs/getting-started/introduction)、[外部根与手动帧循环](https://r3f.docs.pmnd.rs/api/canvas)、[useFrame 优先级与 advance](https://r3f.docs.pmnd.rs/api/hooks)。版本由 npm 锁文件固定。
