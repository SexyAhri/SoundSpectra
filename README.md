<div align="center">
  <img src="assets/app-icon.svg" width="88" alt="SoundSpectra 图标" />
  <h1>SoundSpectra · 声谱</h1>
  <p>让音乐成为桌面的一部分。</p>
  <p>音乐灯效 · 动态歌词 · 音乐卡片 · 壁纸视差</p>
  <p><strong>1.0.2</strong> · Windows x64 / macOS Universal · React / Three.js / Tauri / Rust</p>
  <p><a href="https://github.com/SexyAhri/SoundSpectra/releases">下载安装包</a> · <a href="#项目展示">项目展示</a> · <a href="#开发运行">开发运行</a> · <a href="https://github.com/SexyAhri/SoundSpectra/issues">反馈问题</a></p>
</div>

![SoundSpectra 工作台：旋臂星空与文字漫游](docs/images/workspace.webp)

SoundSpectra 是一款桌面音乐可视化工具。它捕获所选播放器的音频，让三维灯效、动态歌词和音乐信息融入桌面；日常使用时保持鼠标穿透。Windows 使用进程音频环回与桌面宿主，macOS 使用 ScreenCaptureKit 与 AppKit 桌面层。

## 项目展示

### 音乐有形，桌面有光

13 种可选灯效，包括晴空浮游、雪花飘舞、梦幻星空、星瓣花境、极光流域和星尘航道。最多四个独立区域，可以分别调整位置、大小、视角和外观，再用柔边遮罩融入桌面。

| 晴空浮游 | 雪花飘舞 |
| --- | --- |
| ![晴空浮游的实际渲染画面](docs/images/clear-sky.webp) | ![雪花飘舞的实际渲染画面](docs/images/snowfall.webp) |

### 歌词也能成为构图

三种动态文字编排，支持逐字高亮、位置拖放、缩放、背景透明度和同步微调。时间由播放器驱动，暂停、拖动进度和切歌都会重新同步。

| 文字漫游 | 错落排版 | 弧形流转 |
| --- | --- | --- |
| ![文字漫游](docs/images/lyrics-roaming.webp) | ![错落排版](docs/images/lyrics-staggered.webp) | ![弧形流转](docs/images/lyrics-arc.webp) |
| 呼吸与推移 | 拆句与留白 | 弧线与环游 |

[观看三种歌词编排的 21 秒演示](docs/media/lyric-compositions.webm)。展示图和视频使用实际渲染器、模拟音频与原创示例文字，不代表真实播放器已连接。

### 一处预览，分别编辑

灯效、歌词、音乐卡片和壁纸各有独立编辑入口。预览始终可见，底部集中放置音源、桌面输出和性能控制。音乐卡片提供唱片、简约两种样式；壁纸可添加轻微视差。

![音乐卡片与独立编辑面板](docs/images/music-card.webp)

## 使用

1. 从 [Releases](https://github.com/SexyAhri/SoundSpectra/releases) 下载 Windows x64 的 `setup.exe`，或 Mac Universal 的 `.dmg`。Mac 请将应用拖入 Applications 后运行。
2. 打开音乐播放器播放歌曲，在底部选择「自动识别」或指定音源。
3. 选好灯效，在预览中调整，再开启「显示到桌面」。歌词和音乐卡片可分别启用。

音源菜单支持 **QQ 音乐、网易云音乐、酷狗音乐、酷我音乐、汽水音乐**。歌词联网查询和本地缓存读取同时进行，先找到有效结果就使用，并取消另一侧查询。首次发现的缓存目录会保存，后续优先读取已记住的位置。详见 [歌词说明](docs/LYRICS.md)。

支持场景收藏、配置导入导出、托盘、开机启动，以及省电 30 帧、均衡 60 帧、流畅 120 帧和不限帧四档性能设置。

### 运行条件

- Windows x64 与 WebView2 Runtime，或 macOS 13+；Mac 首次捕获需允许屏幕与系统音频录制权限。
- 歌曲与歌词同步依赖播放器提供的信息：Windows 使用媒体会话，Mac 使用播放器的公开自动化接口。未提供有效时间线的播放器无法同步歌词。已有 QQ 音乐 Windows 实机记录，Mac 和其余播放器仍需逐款实测。
- 浏览器模式只提供模拟预览。壁纸立体效果采用视差近似，不进行 AI 分割或三维重建。
- 正式版从 GitHub 获取签名更新并自动安装，可在应用设置中关闭；开发版不自动更新。早期 0.1.0 需手动安装新版一次。发布前需配置仓库的更新签名 Secrets。

## 开发运行

需要 Node.js 24 与 Rust stable。Windows 另需 MSVC C++ 工具、Windows SDK 和 WebView2；macOS 需 Xcode command-line tools。

```powershell
npm ci
npm run desktop
```

```powershell
npm run dev             # 浏览器模拟预览
npm run build           # 类型检查与前端构建
npm run version:check   # 检查前后端和锁文件版本
npm run test:smoke      # 发布所需的核心浏览器回归
npm run desktop:build   # 当前平台安装包
```

Windows 包输出到 `src-tauri/target/release/bundle/nsis/`，Mac 包位于 `bundle/dmg/`。推送 main 后由 GitHub Actions 执行核心检查并同时构建两端，两端成功后发布新版本；完整浏览器回归可手动运行，不阻塞发布。构建与测试见 [开发说明](docs/DEVELOPMENT.md)，签名配置和自动更新见 [发布指南](docs/RELEASING.md)。

## 仓库导航

| 路径 | 内容 |
| --- | --- |
| `src/features/` | 工作台、预览、灯效、歌词、音乐卡片与壁纸 |
| `src-tauri/src/` | 音频捕获、媒体会话、歌词服务、桌面集成与持久化 |
| `src/assets/`、`assets/` | 场景封面与应用图标 |
| `tests/`、`scripts/` | 回归测试、原生验收、展示捕获与构建发布工具 |
| `docs/` | 开发、歌词、发布说明及精选展示素材 |

[更新日志](CHANGELOG.md) · [开发约定](CONTRIBUTING.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

## 版权与许可

**Copyright (C) 2026 SexyAhri.** SoundSpectra 使用 **GPL-3.0-only** 许可证，完整条款见 [LICENSE](LICENSE)，项目版权说明见 [COPYRIGHT](COPYRIGHT)。第三方组件保留各自的版权与许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。音乐、歌词、专辑封面及用户壁纸的权利归各自权利人所有。
