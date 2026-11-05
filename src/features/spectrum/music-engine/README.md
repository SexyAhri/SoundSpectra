# 音乐分析与场景参数

本地模块提供共享音频分析、参数目录与配置归一化。界面开放 13 种灯效，底层保留 16 个效果 ID 以兼容旧配置；熔金潮汐、水波纹和丹霞声谷不再提供新建入口。原二维绘制实现和流体求解器已移除。

- `effects/musicDriver.ts`：真实 RMS、六频段与 48 格频谱，起音、节拍强度及持续音。
- `effects/musicEnvelope.ts`：阻尼响应与静音淡出。
- `effects/musicSignal.ts`、`musicMotion.ts`、`musicIntensity.ts`：频段归一化与音乐运动信号。
- `catalog.ts`、`types.ts`、`musicAppearance.ts`：效果目录、参数默认值与类型。

预览和桌面都由 `../three/scene-canvas.tsx` 渲染，`SceneMotion` 把上述驱动转换为场景使用的频段能量、起音和波纹。真实音频经 `updateAudio` 输入，不根据画面反推音量。浏览器模拟音频由上层显式选择。

音频和配置契约见 `tests/music-engine-contract.spec.ts`，三维画面验证见 `tests/classic-scenes.spec.ts`。
