# 视觉创作与固定输入审阅

后续连续运动设计、时间线修复和视频 A/B 见 [运动质量记录](MOTION_QUALITY.md)；本页历史静态采样不代替连续性验收。

十一种效果保留原 ID、推荐参数、区域外观历史及场景导入导出格式。`effect-definitions.ts` 集中声明每效果的高级参数、四个艺术入口、常态／起音／持续／收束规则、桌面构图和质量系数。艺术入口直接写入现有字段，不增加持久化 schema；恢复当前效果只恢复其使用的字段。

## 代表场景

- 水母：三层半透明伞体、分瓣褶边与径向组织、连续细管触须、口腕和固定种子的水中微尘。前景个体与背景群分开；低频收缩伞体、中频舒展触须、高频局部微光。宽屏条带保留既有横向分布。
- 丝绸：表面细褶、抗锯齿织纹与掠射光泽，起音沿绸面局部传播，长音维持连续流动。桌面模式缩短、收拢并渐隐绸带端部，沉浸模式保留宽幅曲面。
- 地形：局部频谱映射塑造更集中的山脊，波纹相互叠加，表面有轻微层叠光感。高度纹理与 CPU 参考采用相同公式；实例化和 GPU 高度预计算保持不变。
- 雨线只在部分亮端响应起音；雪晶的横风与局部侧偏分开；浮游羽冠在长音中舒展，只有部分个体短暂上扬；花瓣接入径向起音褶波与长音开放。银河、旋涡、极光及航道保留各自的局部规则。

银河桌面模式的透明度跟随气体分布，并柔和收束承载平面的四边，避免转动或侧置后出现矩形暗片。

经典效果的 `flowDriver` 使用声明中的频段响应时间、持续音流动权重和起音衰减；起音全部来自共享音频帧，不增加检测器。RMS 为零时停止运输，画面透明度及已有波纹仍可自然收束，音频门控的尾音保持不再推动新运输。

## 两种构图与歌词

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
# 全部十一种效果，或指定效果；软件 WebGL 也可用于检查
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

## 本轮验证记录

后续用户反馈对应的最新运动审阅在 `artifacts/motion-quality/final-review/index.html`：全部 11 个效果、各 20 秒连续左右 A/B、每路 601 个仿真帧，涵盖包到达抖动、鼓点、长音、弱音、骤停、完全静音及恢复。其右侧包含音乐回应、银河球壳及黑块修复；旧 `review-final` 图集不包含这些后续修改。四张 `review-sheet-*.png` 汇总各阶段，完整事件曲线在 `report.json`。全部效果无时间/相位倒退、页面错误或卸载后的 GPU 资源残留。输入为合成特征，无声音，不作为物理显示帧率或真实音乐听感证据。

18 个相关测试文件共 106 项用例已分批运行并通过，包含初轮失败的定向复验；不是全仓库测试。失败中涉及高级参数折叠后的旧交互、零 RMS 下尾音保持仍推进运输，以及开发服务热更新导致夹具被重载。旧交互和运输已修正，热更新夹具在关闭 HMR、独立缓存的开发服务上复验通过。最终生产构建通过；仍有既有的大包体积提示。

本地 `artifacts/visual-studies/delivery/index.html` 保存三个代表场景的 42 帧前后对比；`review-final/index.html` 保存十一效果两模式共 154 帧审阅。后者将全效果捕获与银河透明边界修正后的独立重拍汇总，`captureSources` 记录来源，原始报告保留。全部采样的 WebGL／场景错误为零、完全静音覆盖率为零，卸载后几何与纹理计数均为零。同一固定输入的代表场景重放 hash 一致；歌词区域外像素差异为零。

Windows Chrome／ANGLE D3D11、AMD Radeon RX 6700 XT 的 4K 均衡四区域探针，总绘制像素 8,294,400，包含歌词区域柔化与换句影响，120 帧采样的 CPU 提交／GPU 同步耗时中位数均为 1.3ms，P95 均为 1.9ms；每区域 140 次推进恰好绘制 140 帧，错误和卸载资源残留均为零。结果为 `artifacts/r3f/benchmark-balanced-3840-creative.json`。探针不包含歌词文字、原生桌面合成和真实音源采集，因此不代表应用 FPS 或其他设备性能。
