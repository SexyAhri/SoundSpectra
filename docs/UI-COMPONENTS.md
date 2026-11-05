# 界面组件与主题

## 共享层

`src/components/ui` 只负责通用展示与交互，不导入功能状态或 Tauri API。

| 组件 | 使用位置与约定 |
| --- | --- |
| Button / IconButton | 普通动作 / 仅图标动作；IconButton 必须提供可访问名称，保留调用方的 ref 和事件 |
| Slider / Parameter | Slider 提供底层滑动交互；Parameter 统一标签、数值、单位、精度。`onChange` 更新草稿，`onCommit` 可用于松手保存 |
| Switch / SettingToggle | Switch 用于紧凑布局；SettingToggle 统一标题、说明与开关，说明关联到控件 |
| Tabs / ChoiceSelect / Tooltip | 统一选择、导航、浮层及焦点行为，Portal 继承根元素主题 |
| ModalContent | 共享 Radix Portal、遮罩与 Content；关闭、保存锁、Escape 和焦点恢复由功能组件负责 |

歌词、音乐卡片、挂架、区域布局、音乐参数、三维视角共用 Parameter。遮罩柔边等横向紧凑布局继续组合 Slider，避免给通用参数组件添加互不相关的布局开关。

## 主题

- `src/styles/themes.css` 定义两套语义颜色：背景、卡片、浮层、正文、辅助文字、强调、边框、成功、错误与阴影。
- 浅色使用暖灰白和杏棕色；深色使用蓝灰底和柔和杏色。主要文字组合在 `tests/theme.spec.ts` 检查至少 4.5:1 对比度。
- `src/index.css` 将语义颜色映射到 Tailwind；通用控件样式归 `src/components/ui/primitives.css`。
- `src/features/theme/theme.ts` 在 React 首次渲染前应用主题。`soundspectra.theme` 独立保存 `light` / `dark` / `system`，默认深色；系统模式监听系统外观变化，其他窗口通过 storage 事件同步。
- 主题切换不修改场景、歌词、挂架引用或应用更新偏好。桌面窗口仍保持透明背景。
- 设置入口：应用设置与更新 → 常规 → 界面主题。

## 颜色边界

功能样式使用语义变量，禁止为每个页面再写一套浅色覆盖。壁纸、频谱、场景缩略图、唱片材质、挂架木夹和纸张属于内容，保留自身配色。场景缩略图与画面上方提示使用固定的 artwork 色板，以免浅色主题破坏图像可读性。挂架菜单、输入框和便签编辑器使用界面主题，挂好的纸质便签保留纸张颜色。

## 布局与清理

- 工作区布局及断点归 `workspace-layout.css`；检查器归 `inspector.css`，工作室细节归 `studio.css`，各功能保留自身样式。
- 已删除未引用的 StudioHeading、旧的页脚/会话区样式、旧原生下拉框/调色盘样式、重复的滑块和开关行样式，以及被紧凑文件卡片覆盖的规则。
- 弹窗及图标按钮不再依赖应用设置页提供通用样式；挂架编辑器与桌面弹出菜单共用颜色定义。

## 验证

主题测试覆盖保存与重载、键盘选择、跟随系统、窗口同步、透明桌面窗口、正文对比度、菜单与弹窗、各设置页和窄屏布局。现有设置、挂架输入、场景收藏和预览测试继续验证保存与焦点约定。测试运行在独立浏览器中，不操作正在运行的桌面客户端。
