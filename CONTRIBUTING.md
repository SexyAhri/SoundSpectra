# 开发约定

- 桌面端使用 Tauri 2 / Rust，设置 UI 使用 React / TypeScript / shadcn。Windows 原生逻辑与 `platform/macos/` 分开，避免在共享模块直接引入 Win32；Mac 音频辅助程序使用 Swift / ScreenCaptureKit。按功能放在 `src/features/`，通用 UI 放在 `src/components/ui/`。
- 前端以 `package.json` 为版本来源；用 `npm run version:set -- <版本>` 更新全部版本文件，不分别手工修改。
- 用 `npm ci` 和 `Cargo.lock` 安装锁定的依赖。Node 使用 `.nvmrc` 中的主版本，Rust 使用 stable MSVC 工具链。
- 使用 `npm run desktop` 启动桌面端，`npm run dev` 仅启动浏览器预览。浏览器预览不得假装已经连接真实音频或桌面宿主。
- 日常效果修改后直接运行开发版供用户查看；只有用户明确要求打包时才生成安装包。
- PR 前运行构建、相关测试与 Rustfmt；桌面和音频改动需要 Windows 实机检查。CI 不会替代 QQ 音乐和 Explorer 实测。
- 不提交 `.tools`、构建目录、诊断日志、私人配置、签名私钥或 `.env`。发布过程见 `docs/RELEASING.md`。
- README 展示素材只放入 `docs/images/` 与 `docs/media/`，使用模拟输入和原创示例文字；保留素材说明及第三方声明。
- 项目版权署名为 SexyAhri，许可证为 GPL-3.0-only。发布包必须包含 `LICENSE`、`COPYRIGHT`、`THIRD_PARTY_NOTICES.md` 和 `licenses/`。
- `src-tauri/src/desktop.rs` 独立管理效果窗口的 Win32 属性，避免对该窗口混用会重建样式的高层 Tauri setter。
- 更新验证必须保留签名校验；安装前保存和备份设置，不能在下载失败或备份失败后继续安装。
- 推送 main 会自动构建双平台包，新版本会在两端成功后公开 Release；同版本不覆盖旧 Release。拉取请求只构建。私钥放仓库外，Actions Secrets 必须和提交的公钥匹配。
