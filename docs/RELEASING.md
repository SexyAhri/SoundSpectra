# 自动构建、发布与更新

## 上传后会发生什么

推送到 `main` / `master` 或推送与项目版本一致的 `v*` 标签后，若该版本尚未发布，GitHub Actions 执行：

1. 校验版本号、发布签名和构建配置。
2. 分别在 Windows 和 macOS 云端构建。Windows 输出 x64 NSIS `setup.exe`；Mac 输出兼容 Intel / Apple Silicon 的 Universal `.dmg`。
3. 两端构建、签名全部通过后，合并平台更新清单，按明确的 Release ID 上传全部 7 个附件，核验远端大小和摘要，再公开 Release。
4. 任一端失败时不公开这次 Release，已发布的版本和更新清单继续有效。

同一版本已发布时，自动推送只运行准备任务，跳过 Windows / macOS 打包与发布。要推送更新，必须提升版本号。手动运行工作流默认只构建，可为同版本重新生成 Actions 产物；勾选 `publish` 才发布未发布的版本，已有正式 Release 不会被替换。拉取请求只构建。

分支推送或拉取请求仅改动 `docs/`、`tests/`、`scripts/tests/`、本机检查脚本、Playwright 配置、Checks 工作流以及 README / CONTRIBUTING / CHANGELOG 时，不启动自动打包；具体路径见 `.github/workflows/release.yml`。标签推送与手动运行不受此路径过滤限制。安装包已压缩，上传 Actions 产物时关闭额外压缩，临时产物保留 7 天；正式 Release 附件不受此期限影响。

自动发布仅保留版本与签名配置校验、依赖安装、两端签名安装包构建，以及更新清单和附件完整性校验。Tauri 通过 `beforeBuildCommand` 执行一次类型检查与前端构建，不再提前重复构建。发布流程不运行发布脚本测试、Rust 格式检查、Rust 单元测试或浏览器回归，也不依赖 Checks。推送前在本地运行 `npm run check:full`；需要云端验证时手动运行 Checks，勾选 `full` 可追加完整浏览器回归。Checks 不随分支推送自动触发。

发布时先上传安装包与签名，最后上传 `latest.json`；不会按标签模糊匹配草稿。公开 Release 的附件未验收完整时不能发布。修复缺失附件仅补充原版本的已验证产物，不替换已发布文件。

## 首次配置

项目公钥和 HTTPS 更新地址保存在 `release.config.json` 及 Tauri 配置中。私钥、密码保存在仓库外。当前账户可运行以下命令生成或复用同一套密钥：

```powershell
npm run release:setup
```

脚本显示密钥目录，不输出私钥内容。将对应文件内容放入 GitHub 仓库 Settings → Secrets and variables → Actions：

| Secret | 来源 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `updater.key` 文件内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `updater-password.txt` 文件内容 |

备份这套密钥；已安装版本信任其公钥，后续不能随意更换。已有密钥不完整时脚本会停止，不覆盖旧密钥。Tauri 更新签名与 Windows Authenticode / Apple 开发者签名是不同的用途。

Mac 构建目前使用临时代码签名，不包含 Apple 公证；初次安装可能需要在系统安全设置中允许打开。若需要 Apple 公证分发，需另行配置 Apple 开发者证书与公证凭据。

## 客户端更新

正式安装版默认启动并加载更新配置后检查一次，运行中每 6 小时再检查。更新地址为：

```text
https://github.com/SexyAhri/SoundSpectra/releases/latest/download/latest.json
```

默认开启自动下载安装。找到更高版本后，客户端自动下载匹配当前平台的包，验证签名，保存并备份配置，随后替换旧版并重启。Windows 调用 NSIS 安装器；Mac 使用签名的 `.app.tar.gz` 替换应用并重启，DMG 供首次安装使用。

可在应用设置中关闭自动安装，改为查看版本信息后手动下载和安装。下载失败、签名不符、保存或备份失败都不会继续安装。开发构建不执行自动更新。

**早期 0.1.0 安装包没有更新公钥，需先手动安装新的 1.0.1 一次。** 之后的正式版本才能自动更新。Mac 初次安装应从 DMG 把应用拖入 Applications 后运行。

## 本地构建

Windows 需要 Node.js 24、Rust stable MSVC、MSVC C++ 工具、Windows SDK 和 WebView2。macOS 需要 macOS 13+、Xcode command-line tools、Node.js 24 与 Rust stable。

```powershell
npm ci
npm run version:check
npm run desktop:build -- -- --locked
```

Windows 输出到 `src-tauri/target/release/bundle/nsis/`。Mac 原生构建输出到 `src-tauri/target/release/bundle/dmg/`。构建 Universal 包时先安装两个 Rust 目标：

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run desktop:build -- --target universal-apple-darwin -- --locked
```

需要签名更新归档时，在本地终端设置两个签名环境变量，再运行：

```powershell
npm run release:prepare
npm run desktop:build -- --config src-tauri/tauri.release.conf.json -- --locked
```

不要把私钥或密码写入命令示例、仓库、日志或诊断报告。基础配置包含 SexyAhri 版权、项目 LICENSE、COPYRIGHT、THIRD_PARTY_NOTICES 和 licenses 目录。无需从 artifacts 加载本地补丁配置。

## 版本与验收

版本号按 `主版本.次版本.补丁版本` 比较，每段是独立整数。补丁递增为 `1.0.10 → 1.0.11`；向后兼容的新功能通常升到 `1.1.0`，该系列后续修复为 `1.1.1`。补丁数字到 10 不会向次版本进位。自动更新只要求新版本高于已安装版本，并且签名更新包与清单已正式发布。

```powershell
npm run version:set -- 1.0.11
npm run version:check
npm run test:release
npm run build
```

每次发布递增版本号并更新 CHANGELOG。Windows 与 Mac 都应验证首次安装、旧版自动下载、签名验证、配置保留、失败重试和重新启动。浏览器 IPC 测试只验证调用顺序，不能替代真实的两版本安装验收。工作流构建成功也不代表已经在每一款音乐播放器上实测。

安装目录与用户配置分开。升级保留 settings、preferences、audio-source 和 lyric-locations；安装前备份场景、偏好和音源到配置目录的 backups。未知配置版本不覆盖原文件。项目采用 GPL-3.0-only，完整条款及第三方说明随安装包提供。
