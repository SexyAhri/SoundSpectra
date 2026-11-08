# 视觉与音乐分析

本页维护渲染生命周期、音乐驱动与验证约定。界面操作见 [桌面功能](DESKTOP.md)，环境与通用命令见 [开发与验证](DEVELOPMENT.md)。

## 入口与组合

```text
Rust PCM / FFT → AudioFeatureTimeline → SceneMotion
                                        ↓
VisualScene → CameraRig + 视觉层 → HDR / Bloom → 透明合成 / 遮罩
```

场景入口是 `src/features/spectrum/three/r3f/visual-scene.tsx`。全部效果共用 React Three Fiber 根、相机和合成器，保留 Three.js 自定义材质及实例化几何。React 管理组合与生命周期，逐帧只更新 uniform，不更新 React state。

| 层 | 职责 |
| --- | --- |
| `ClassicLayer` | 经典及自然意象效果的几何工厂 |
| `AmbientLayers` | 花瓣、极光、粒子、航道与飘带 |
| 空间构图层 | 潮汐之结、层海、回声廊道，与实验室共用实现 |
| `TerrainLayer` | GPU 高度预计算与实例化柱体，CPU 参考公式同步维护 |
| `CameraRig` | 区域独立的旋转、平移、滚转与缩放 |
| `SceneCompositor` | HDR 降级、曝光、Bloom、透明度、区域坐标与遮罩 |

新增层通过 `useVisualFrame` 读取 `settings/motion/dt/reduced/regions/pointer`。相机及 GPU 预计算用负优先级，视觉层用 0，最终合成用 1；层内不创建额外渲染器、RAF 或音频分析器。

外部宿主处理可见性、离屏休眠和帧率预算，以 `advance(seconds)` 推进接受的帧。每次 `root.configure()` 都显式设置 `frameloop: 'never'`，包括仅更新尺寸时，防止自动循环造成重复绘制。

兼容导出 `classic-renderer.ts`、`ambient-renderer.ts`、`terrain-renderer.ts` 均指向同一 R3F 实现。独立截图先等待 `world.resize(config, regions)`，再调用 `draw` 和读取像素；空白测试页通过 `scripts/visual-probe-html.mjs` 安装 React 开发前导脚本。

## 参数与音乐映射

视觉层只读取 `SpectrumSettings` 和 `MusicSettings`，保存、校验、区域隔离与导入导出沿用共享模型。配色通过 `resolveEffectPalette` 的 `low/main/accent/high` 语义颜色解析；效果 ID 以 `music-engine/catalog.ts`、`effect-definitions.ts` 为准。

| 时间尺度 | 输入 | 用途 |
| --- | --- | --- |
| 快速冲击 | `frame.onset/pulse/beatStrength` | 局部点亮和冲击，起音不等于 BPM |
| 中速形变 | `volume`、`bass/middle/treble`、`frame.spectrum` | 曲面、柱体、材质呼吸，频谱结合真实响度 |
| 缓慢运输 | `phase`、`auroraPhase` | 路径与折叠，静音停止，减少动态时冻结 |

`frame.intensitySample.current` 保留原始 RMS。归一化频段用于形状，不覆盖音量，也不将平滑频谱的最大值当作原始响度。场景使用确定性种子和共享分析，不增加私有节拍检测或远程贴图。

## 音频时钟

Rust 每个 1024-sample hop 发布一帧，包含 `sourceRevision`、`streamId`、`sequence`、`samplePosition`、`sampleRate`。48kHz 输入采用 4096 点 FFT；`samplePosition` 表示窗口末端，重连更换 stream，音源选择变化更换 revision。

`AudioFeatureTimeline` 按采样位置推进分析，拒绝重复、倒序及旧音源帧。接收时刻用于映射本地显示时钟和判断 350ms 失联，不直接与采样时间比较。区域共享起音序号，每个事件只消费一次，区域参数只改变外观映射。

显示频段在历史帧之间插值，标称保留一个 hop 的余量；瞬态不插值。到达抖动不重置显示段，时钟保持单调；超出余量的延迟等待捕获端点，因此一个 hop 不是端到端延迟上限。持续校正设备时钟漂移，事件时钟最多领先最新采样一个 hop。

失联后停止外推声音，恢复或重连清空旧分析并保留空间路径。模拟预览也按固定 1024/48000 时钟生成分析，与显示刷新率无关。

## 连续运动与资源

Windows 以 500ms 间隔检查前台窗口是否覆盖桌面输出窗口的实际范围，连续两次覆盖后通过 `desktop://occlusion_changed` 发布 `{ occluded }`。排除桌面、最小化、隐藏、cloaked 及分层透明窗口；跨屏输出不能按单个显示器裁剪后判定。重新露出桌面或进入编辑模式时恢复。初始状态通过 `get_desktop_occlusion` 读取，前端先订阅后读取，避免窗口重建时漏掉状态。

遮挡时停止灯效 RAF 和计时器，保留 GPU 资源与空间路径，清除旧音频冲击；壁纸、卡片及歌词停止绘制，音源、歌曲与演出状态继续同步。恢复仅消费当前输入，沿用原场景，不补跑隐藏期间的动画。

桌面输出使用异步 GPU query 调节视觉 FBO，档位为 100% / 85% / 75%；最终画布和文字布局保持原尺寸。连续 120 个 GPU 样本超过当前帧率预算的 105% 后降档，连续 360 个样本低于预算的 65% 后升档；降档冷却 6 秒，升档冷却 8 秒。编译、切场景、转场、尺寸变化及休眠恢复排除采样；无效 GPU 时钟丢弃待处理结果。计时扩展不可用时保留静态像素预算，不用 CPU 提交耗时冒充 GPU 时间。预览和导出默认使用固定分辨率。

`SceneMotion` 持有相位、惯性和路径；重复绘制、几何重建或外观变化不重播路径。`reactive-motion.ts` 只随接受的模拟步更新，使用有界形变响应、非负累计转角和最多八个真实起音波；不以周期时钟伪造节拍。水母和空间构图保留各自运动系统，共用源分析。

换源通过 `resetRevision` 清理旧事件，即使采样时间没有倒退也应重置；事件缓存用 `simulationTime` 补计离开场景期间的年龄，切回时不重放过期鼓点。静音及减少动态停止路径运输，局部形变允许收束。

`r3f/quality.ts` 管理几何、MSAA 和 Bloom；像素与帧率由各自的 `render-budget.ts` 管理。多区域共享预算并缩减密度。组件释放自己创建的几何、材质、纹理和离屏目标；工厂 primitive 通过 `disposeVisualTree` 显式释放，共享资源由所有者统一释放。质量变化替换视觉资源，保持 context；卸载停止调度并释放根及 context。

场景维护重点：

- 频谱回响共用 GPU 高度预计算，保持平整柱顶和连续升降；CPU/GPU 公式成对更新。
- 层海占屏铺展通过相机与 uniform 调整，窗口比例改变不重建粒子缓冲区。
- 水光焦散按连续曲率和投影面积聚光，弱光片元同步降低透明度，避免三角网格断层。
- 晴空浮游、秋光银杏、水光焦散共用 `immersive/daylight-field.ts` 的局部空间光场，物体与浮尘采样同一光区。三束实例化光带近似散射，不计算真实遮挡，不新增全屏后处理；桌面模式减弱光带，慢能量与低频只轻调透光。
- 窗前听雨 `window_rain` 独立于地面落雨：实例化水珠与滑痕在 GPU 上连续行进，局部汇合采用确定性近似。沉浸模式的窗外散景使用实例化光斑，水珠内折射采样同一程序环境；桌面模式保留透明区域与水珠反光，不采样或扭曲系统壁纸。
- 透明 HDR 材质限制法线、幂底与边缘 UV 的有效范围，防止 NaN 经 Bloom 扩散。

## 两种构图与歌词

融入桌面的细节可见性由 `r3f/desktop-visibility.ts` 在共享合成 pass 中调节：提高有效片元覆盖，并添加窄暗边。空白像素保持透明，最终统一应用不透明度、静音显隐与遮罩。沉浸模式保留完整空间；`CompositionLayout` 在用户视角之上做布局，减少动态时冻结运镜，宽条带不应用侧置。

每个预览与桌面窗口独立持有 `SceneFocusProvider`。歌词只在存在可读行时发布实际区域，拖动、缩放与拾光绳避让同步更新；关闭、前奏或桌面不可用时移除。合成器只在歌词区域柔化纹理和 Bloom，换句微光按接受的 dt 推进；静音、减少动态或重复绘制不产生额外冲击。

歌词灯光读取共享 `AnalysisSnapshot.timeline`：低频推动折幕，中频延展亮面，高频点亮细线；文字仍只绘制一份，逐字高亮沿用歌词时钟。暂停或输入过期时关闭音乐强调。折幕分任务预备相邻三句纹理，每个任务最多一个短语面板；换歌、字体变化和离开预备范围时取消任务并释放资源。

## 窗口缩放与原生排查

首次绘制前等待 shader 准备，各离屏 pass 按自身目标编译。场景串行准备，关闭时等待编译轮询结束再释放；未就绪的 draw 保留 dirty 状态。纯尺寸变化复用 context、材质和准备缓存，只提交最新尺寸；场景、质量、密度、区域数量或构图变化可能要求重新准备。

工作台预览共享 1920×1080 像素预算。ResizeObserver 在 RAF 中合并测量，最大化状态 IPC 合并查询。标题栏操作先暂停呈现并让出 32ms，尺寸安静 160ms 后调整缓冲区，期间音频和动画状态继续推进。恢复必须等待最新异步尺寸提交完成，旧请求不能解除新请求的等待。

开发版 F8 显示 context、准备次数、program 数、缓冲区耗时、RAF 间隔、long task 和恢复等待。次数增加时检查重建；长任务时检查同步工作；只有 RAF 间隔过大时继续检查 WebView2 调度与原生呈现。

用户反馈最近一轮窗口测试没有明显停顿，但原先 2–3 秒停顿的原因及安装版差异尚未确认。`node scripts/measure-native-window-resize.mjs LABEL` 连接 9223 调试端口，通过标题栏做两次最大化/还原，结束恢复窗口并比对配置。浏览器 viewport resize 和 RAF 数据不能单独证明物理呈现问题已解决。

## 画面实验室与验证

开发服务提供 `/tools/visual-lab.html` 和 `/tools/composition-lab.html?scene=sculpture`，复用生产场景；前者支持载入主区域参数、内存 A/B 对比和透明 PNG。输入为明确标注的合成特征，按包时钟采样、固定 30Hz 重放，不播放或采集声音。

```powershell
npm run visual:compare -- --label=review --all
# baseline 必须是本机已生成且仍保留的报告
npm run visual:compare -- --label=followup --baseline=review
npx playwright test tests/audio-timeline.spec.ts tests/r3f-runtime.spec.ts tests/scene-lifecycle.spec.ts tests/reactive-motion.spec.ts
npx playwright test tests/scene-preparation.spec.ts tests/scene-resize.spec.ts tests/desktop-visibility.spec.ts
node scripts/check-music-transitions.mjs review
```

| 变化 | 补充检查 |
| --- | --- |
| 场景外观 / 材质 | 对应场景测试、`tests/hdr-surface-boundaries.spec.ts`、`tests/effect-palette.spec.ts` |
| 铺展 / 空间构图 | `tests/expanse-fill.spec.ts`、`tests/composition-scenes.spec.ts` |
| 歌词响应 / 静置 | `tests/lyric-audio.spec.ts`、`tests/folded-production.spec.ts`、`tests/idle-rendering.spec.ts` |
| 原生编译准备 | `tests/native-scene-preparation.spec.ts` |

`check-music-transitions.mjs` 检查弱音、密集冲击、暂停、断包和换源；`--capture=PATH` 可追加已有真实分析事件。`check-live-scene-response.mjs LABEL` 使用当前真实分析事件检查细节场景，不保存 PCM 或修改配置。`visual-benchmark.mjs` 用于同机成本比较，`--lyrics` 只添加歌词区域影响、不绘制文字。

输出按脚本写入 `artifacts/`，运行后生成；历史产物已清理，旧源码及基线不能视为仍存在。检查应覆盖相位单调、重复帧、30/60/120Hz、静音、减少动态、WebGL 错误和释放后的资源。截图、软件 WebGL、CPU 提交或同步 GPU 等待不能直接代表应用帧率；真实采集、桌面合成、多屏、休眠和 macOS 仍需实机验证。

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

探针嵌入 DSP 源码指纹，启动器核对请求源码，不一致则拒绝测量。

分析结果由上述命令生成到 `artifacts/music-analysis/`。历史基线已清理，默认验证当前实现；需要版本比较时必须另行提供旧源码，并使用独立的 package/bin 名称。

像素响应按固定 PCM、种子、镜头和采样时间重放，记录起音和首次达到事件画面峰值 5% 的时刻。该模拟不包括系统采集、传输、调度、垂直同步与物理显示。85.3ms 窗长及各层平滑时间常数不能相加视作端到端延迟。

### 实机验证边界

到达偏移需随设备时钟漂移持续校正，事件时钟最多领先最新采样一个 hop；修正显示时钟不改变原生 RMS 与源端起音。真实音源听感、端到端响应、不同声卡/底噪与 macOS 行为仍需现场验证。

### 参考

- [SciPy periodogram：density/spectrum、单边功率及窗口缩放](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.periodogram.html)
- [librosa onset_strength：正谱通量及相邻频率最大参考](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_strength.html)
- [librosa 官方多区域起音实现和说明](https://librosa.org/doc/main/_modules/librosa/onset.html)

本实现参考这些定义进行工程取舍，不宣称复现完整 librosa 检测器，也没有新增人声、乐器或副歌识别。
