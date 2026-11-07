# 音乐分析与视觉驱动

后续显示时钟及包边界插值修复见 [运动质量记录](MOTION_QUALITY.md)。本轮没有重写生产 PCM DSP 或重新检测场景节拍；原始 RMS 与捕获起音语义保持。

本轮关注同强度音色的可比性、弱音连续性、真实强弱关系和起音的频率性格。原生采集仍在 Rust 完成；没有把 PCM 再送入 Web Audio 做第二次分析。

## 数据语义

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

## 门限与强弱

共用门限在采样时钟上运行：RMS ≥0.0015（约 -56.5dBFS）打开，低于 0.0008（约 -61.9dBFS）持续 100ms 才关闭。中间区间保持原状态，短断音不反复闪烁；后续可见性和形变使用各自的释放包络。区域参数变化重放的是已经判定的同一门限状态，不会各自改变全局起音。

原始 RMS 保持不变；没有持续增长的自动增益。灵敏度保留 0.5–2 的范围与原有平滑运动 `gain/2` 的尺度，作用于视觉强度和频段曲线。它不修改原始 RMS，也不降低物理门限。低于开启门限的微弱声音仍保留在原生物理特征中，但默认不启动画面。

场景整体可见度也表达绝对强弱：复用现有包络的 RMS 通道，将可见度乘以 `0.2 + 0.8 * sqrt(clamp(energy / 0.12))`。其中 `energy` 取平滑 RMS 与 `当前 RMS * clamp(pulse * 4)` 的较大值。后者只加快真实起音，不能把能量提高到当前 PCM RMS 以上；持续音仍走原有包络，没有再串联一层平滑。弱音保留克制的可见下限，静音释放到零；鼠标触摸保持独立。驱动字段 `displayPresence` 仍是门限包络，最终场景的 `SceneMotion.presence` 才包含这项强弱映射，两者不要混用。

固定门限不能区分同 RMS 的底噪和音乐。合成低噪声验证只能验证下限稳定性，不能代替真实声卡、系统音量、录音噪声与不同音乐的试听。持续高于门限的噪声仍可能显示，这不是噪声分类器。

## 起音与时间

起音使用细分频谱的正差分，以前一帧相邻频率的最大值作为参考，抑制小幅音高摆动。低、中、高区域分别维护因果阈值和重新准备状态；矩形 PCM RMS 的上升保留快速触发路径。新到达的功率决定区域支撑，持续响亮的低频不会直接盖掉新出现的轻微高频。整体衰减时，只有有足够新区域能量才允许触发，避免把硬断音的频谱扩散当作新起音。

同一事件在短时间内可以随着谱窗填满而增加包络强度，但不重复增加事件序号。起音去重为 65ms；持续音不会按估计间隔自动起拍。通用冲击对中、高频施加 0.65 / 0.3 的艺术权重，三个原始区域包络仍分别提供给效果。

共享时间线继续按每个捕获 hop 推进，参数缓存不拥有独立节拍。采样时钟断开后重置分析状态，350ms 没有新到达帧则停止消费；收到持续但延迟的包不因为 UI 抖动自行重置。无效采样时钟在消耗序号之前拒绝。场景睡眠恢复仅消费当前新鲜事件。

## 可重复验证

```powershell
node scripts/probe-music-analysis.mjs
node scripts/measure-music-analysis.mjs
node scripts/desktop.mjs --cargo test --manifest-path scripts/dsp-probe/Cargo.toml --target-dir artifacts/music-analysis/native-target
npx playwright test tests/music-analysis-native.spec.ts tests/audio-timeline.spec.ts tests/music-engine-contract.spec.ts
```

独立 Cargo 探针直接编译生产 `src-tauri/src/dsp.rs`，输出每个 hop；没有复制 DSP 公式来冒充原生执行。PCM 振荡器用 f64 生成后量化到 f32，避免高频长相位的 f32 运算误差干扰比较。输入包括等 RMS 不同频率、两窄带、宽带噪声、弱音、静音、低噪声、同相/反相/单侧输入、瞬态与结束、颤音、缓慢渐强、持续低音上的轻高频起音、同区域等能量换音和弱音短间隙。

生产与基线探针分别使用独立的 Cargo package/bin 名称，避免共享 target 目录时同名可执行文件互相覆盖。可执行文件嵌入所编译 DSP 源码的 FNV64 指纹，JS 启动器再与请求的源文件逐字节比对；不一致就拒绝输出测量结果。已按“基线→生产”的顺序交叉验证。本次基线指纹为 `3a8f020096e96c16`，新版为 `ef282d3f8d353397`。

前后比较使用工作开始时保存的 `artifacts/music-analysis/baseline-dsp.rs` 与 `baseline-src/spectrum`。保留基线后可运行：

```powershell
node scripts/probe-music-analysis.mjs --source=artifacts/music-analysis/baseline-dsp.rs --out=artifacts/music-analysis/baseline-native.json
node scripts/measure-music-analysis.mjs --legacy --root=artifacts/music-analysis/baseline-src/spectrum --input=artifacts/music-analysis/baseline-native.json --out=artifacts/music-analysis/baseline-measurements.json
node scripts/capture-music-analysis.mjs --hardware --render-root=/artifacts/music-analysis/render-v3-src/features/spectrum
node scripts/measure-music-visual-response.mjs --hardware --render-root=/artifacts/music-analysis/render-v3-src/features/spectrum
```

视觉比较对同一版本的当前渲染器分别输入旧/新分析及旧/新驱动；画幅、参数、随机造型种子、PCM 与采样时间一致。十一种效果分别覆盖弱音、低/中/高频等强纯音、固定起音和静音释放。图像及原始像素指标保存在 `artifacts/music-analysis/visual`。

本次使用冻结的 `render-v3-src/features/spectrum` 渲染器隔离算法差异，不包含另一视觉打磨任务之后的材质、构图及静音运动停止调整。当前生产场景另通过生命周期回归验证。该目录与基线快照均为本机验证产物，不属于生产代码；未保留快照时，去掉 `--render-root` 可验证当前渲染器，但不再是本报告的固定版本比较。Vite 忽略 `artifacts` 文件监听，因此修改快照内容后必须换用新目录或重启服务，避免读取旧变换缓存。

响应测量在 160×90 上按采样时间重放真实原生特征并读回像素：起点定义为首次达到该次事件实测画面峰值的 5%，并另记起音时刻和画面峰值。它是 PCM→特征→场景→像素的确定性模拟，**不包括**系统采集、传输、渲染调度、垂直同步及物理显示延迟。85.3ms 窗长不作为端到端延迟；各层平滑时间常数也不相加当作实测结果。

## 验证结果（2026-11-07）

39 组合成 PCM 输入通过实际 Rust DSP。三个窄带输入的 PCM RMS 均为约 `0.141421`，旧版与新版频段显示峰值如下。新版对应范围的物理 RMS 也均为约 `0.141421`；这证明消除了频段宽度导致的稀释，不表示不同音色应有完全相同的艺术画面。

| 频率 | 旧版显示峰值 | 新版显示峰值 |
| --- | ---: | ---: |
| 70.3125Hz | 0.278608 | 0.603418 |
| 996.09375Hz | 0.024765 | 0.603418 |
| 8003.90625Hz | 0.003483 | 0.603418 |

`0.004 RMS` 的中频弱音由全零频段变为 `0.144956` 的显示峰值，原始 RMS 不变。默认灵敏度下驱动平滑强度约 `0.002`，保留既有 `gain/2` 尺度。恒定 `.2/.4/.8` 频段维持强弱比例；缓慢渐强由旧版 4 次起音降为开始的 1 次，持续颤音也只在开始触发。低、中、高各 5 次短音均独立触发且结束不误拍；持续低音上的 5 次轻高频均检出，同区域换音得到开始和换音共 2 次。

自动检查：音频时间线、驱动契约与原生 PCM 共 **16 项通过**；Rust 全量 **85 项通过、4 项忽略**。生产前端构建及 Windows `custom-protocol` 原生构建通过。原始数值在 `artifacts/music-analysis/{native,measurements,baseline-native,baseline-measurements}.json`，测试日志在同一目录。

真实 GPU（AMD Radeon RX 6700 XT / ANGLE D3D11）完成 **132 张**对照图（11 效果 × 6 输入 × 新旧两版），页面异常、场景失败、WebGL 错误均为零。11 效果的弱音旧版均无像素，新版均可见；新版弱音的透明度加权亮度总和为同效果强音的 **9.3%–12.4%**。长静音释放后，11 效果的像素和总亮度均归零。此像素指标用于受控比较，不等同于主观响度。图集为 `artifacts/music-analysis/visual/overview.png`，逐图数据为 `visual/report.json`。

**18 组**响应比较覆盖声场、律动肌理与极光的低、中、高频短音。首次起音检测延迟均为 **5.33ms**；达到各自实测首击画面峰值 5% 的时间，新旧均为 **26.67ms**。新版画面峰值为 **133.33–154.67ms**，旧版为 **133.33–176.00ms**，部分组合提前一个 hop（21.33ms）。这些是本次固定事件相位和采样时钟的离散读回结果，不是所有实际输入都能保证的延迟，更不是实机端到端延迟。完整曲线在 `artifacts/music-analysis/visual-response.json`。

当前生产代码的场景生命周期检查另有 **2 项通过**，覆盖减少动态时的触摸消退，以及极小场景尺度、极远视距下横竖画幅仍有可见几何。

后续真实 QQ 音乐检查发现捕获时钟与本地时钟的长期漂移使事件年龄领先约 4.7 秒，导致瞬态在消费前衰减。前端现采用最近两秒的到达偏移窗口，限制事件时钟最多领先最新采样一个 hop，并保持显示时钟单调；原生 DSP、原始 RMS 和源端起音保持不变。修复前后各有 12 秒实机观测，修复后恢复非零频段瞬态，但两段播放内容不同，不作相同 PCM 的幅度对照。详见 [运动质量记录](MOTION_QUALITY.md)。

尚未量化真实音源听感、桌面采集链路的端到端响应与 macOS 实机行为。

## 参考

- [SciPy periodogram：density/spectrum、单边功率及窗口缩放](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.periodogram.html)
- [librosa onset_strength：正谱通量及相邻频率最大参考](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_strength.html)
- [librosa 官方多区域起音实现和说明](https://librosa.org/doc/main/_modules/librosa/onset.html)

本实现参考这些定义进行工程取舍，不宣称复现完整 librosa 检测器，也没有新增人声、乐器或副歌识别。
