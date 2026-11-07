# 视觉开发

十一种现有效果统一通过 React Three Fiber 9 渲染，保留 Three.js 自定义材质、实例化几何和 Rust 音频采集。React 负责视觉层的组合及生命周期，逐帧更新通过 `useFrame` 写入 GPU uniform，不逐帧更新 React state。

## 入口与组合

`src/features/spectrum/three/r3f/visual-scene.tsx` 是场景配方入口，所有视觉层共享 `CameraRig` 和 `SceneCompositor`：

```text
Rust PCM / FFT → AudioFeatureTimeline → SceneMotion
                                        ↓
VisualScene → CameraRig + 视觉层组合 → HDR / Bloom → 透明合成 / 遮罩
```

- `ClassicLayer` 挂载七种经典效果的既有几何工厂，保留水母宽屏长焦等画面设计。
- `AmbientLayers` 组合花瓣或极光曲面、`ParticleField`、航道与飘带。`LightSurface` 封装透明混合、GPU 材质和资源所有权，可复用在其他配方中。
- `TerrainLayer` 将共享的 `createTerrainGrid` 种子上传一次，通过高度纹理驱动实例化柱体，不逐格做 CPU 高度计算。
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

连续运动排查、逐效果运动语言及前后证据见 [运动质量记录](MOTION_QUALITY.md)。

后续音乐回应修正将持续能量、频段和短时起音分别供给场景；长时间设备时钟漂移不会再把新起音提前衰减掉。常规外观仅保留空间、光感、音乐参与度三项主要偏好，数量、尺寸和方向位于“造型细节”。旧参数仍可载入，原始采集 RMS 和源端检测不变。

银河由球壳承载，星点和气体共用角坐标及旋转，避免显露矩形平面的斜切边。透明 HDR 曲面的法线/幂底范围与极光薄幕的边缘 UV 已限制，避免单个 NaN 经 Bloom 形成黑块；落雨的起音落点 GLSL 声明已补齐。复现序列及定向回归见运动质量记录。

## 质量与资源

`r3f/quality.ts` 决定几何密度、地形网格、MSAA 和 Bloom 层数；`three/render-budget.ts` 限制总像素；`render-budget.ts` 控制接受帧率。节能 / 均衡 / 流畅分别使用 1 / 2 / 3 层 Bloom、0 / 最多4 / 最多4 MSAA。增加区域时按区域数分配像素，按平方根降低几何密度，保留相同的场景层次和音频含义。

R3F 拥有一个画布的根和渲染器。组件拥有自己创建的材质、几何、纹理及离屏目标；工厂 `primitive` 通过 `disposeVisualTree` 显式释放，不能依赖 R3F 自动清理 primitive。共享曲面用 `dispose={null}`，由持有资源的组件统一释放。卸载同步提交清理，停止外部调度；根释放渲染器和 WebGL context。质量/密度变化替换视觉层资源，不新建 context。

## 验证

```powershell
npm run build
npx playwright test tests/audio-timeline.spec.ts tests/r3f-runtime.spec.ts tests/scene-lifecycle.spec.ts
npx playwright test tests/classic-scenes.spec.ts tests/ambient-scenes.spec.ts tests/sound-field.spec.ts tests/effect-palette.spec.ts tests/hd-scenes.spec.ts
node scripts/desktop.mjs --cargo test --manifest-path src-tauri/Cargo.toml --locked
```

本次全量浏览器回归首轮为 245/250，通过复现定位并修复尺寸配置恢复自动帧循环的问题后，两批定向复验共 73 项全部通过，包含首轮五项失败用例。Rust 测试 82 项通过、4 项忽略；前端生产构建与 Windows `custom-protocol` 原生构建均通过。

启动 `npm run dev` 后，可运行以下探针，结果输出到忽略的 `artifacts/r3f/`：

```powershell
node scripts/visual-probe.mjs --hardware
node scripts/visual-benchmark.mjs --width=3840 --height=2160 --quality=balanced
```

第一项逐一渲染十一种效果。第二项在实际显卡上同时运行极光、水母、地形和星际航行四个区域，预热 20 帧后采样 120 帧；记录 CPU 提交耗时、调用 `gl.finish()` 等待 GPU 后的同步耗时、帧间隔、实际绘制像素和卸载资源计数。同步等待会阻塞流水线，结果用于对比当前机器的场景成本，不能直接当作应用帧率。像素预算在四个区域间共享。

2026-11-07 在 Windows、Chrome / ANGLE D3D11、AMD Radeon RX 6700 XT 上，均衡模式四个 1920×1080 区域合计 8,294,400 像素。120 帧采样的 CPU 提交与同步耗时中位数均为 1.1ms，P95 均为 1.7ms；每个区域 140 次手动推进恰好产生 140 帧，WebGL 错误为 0，卸载后几何与纹理计数均为 0。探针按浏览器 rAF 推进，未经过应用帧率门控，也未包含桌面窗口合成与原生音源采集成本。这是该机器和模拟输入的一次测量，不是其他显卡或 Tauri WebView 的性能保证。

截图和性能探针使用明确的模拟音频，不能作为真实音源采集证据。软件 WebGL 与 CPU 提交时间也不能代表用户 GPU 的帧率。原生采集、桌面层级、多显示器、休眠恢复和 macOS 权限仍需对应平台实机验证。

依赖依据：[R3F 与 React 版本对应](https://r3f.docs.pmnd.rs/getting-started/introduction)、[外部根与手动帧循环](https://r3f.docs.pmnd.rs/api/canvas)、[useFrame 优先级与 advance](https://r3f.docs.pmnd.rs/api/hooks)。锁定 `@react-three/fiber@9.8.2`，配套现有 React 19 和 Three r180，未采用 R3F 10 alpha。
