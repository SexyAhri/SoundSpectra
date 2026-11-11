# 网易云账号与播放接入

本模块通过 Rust 直连官方接口，提供网页登录、账号与会员信息、个人歌单读取、搜索、歌词、封面和播放。业务层不依赖本地 API 中转服务。

## 登录与会话

官方网页负责二维码、轮询和额外验证。Native 从应用独立的 WebView 取得 Cookie，经账号接口验证后保存到独立 DPAPI 文件；应用前端只收到二维码和固定状态。刷新二维码会等待旧登录窗口释放，避免同名窗口冲突。取消、切换平台或账号后，旧请求不能附加会话。

会员兼容 `expireTime` / `endTime`；资料不可用时显示会员状态待确认。私有歌单完整性和高级音质覆盖取决于实际账号权限。

## 读取接口

以下 GET 请求直接发送到 `music.163.com`，由 Native 携带会话 Cookie 和 `csrf_token`。

| 路径 | 用途 |
| --- | --- |
| `/api/nuser/account/get` | 校验账号资料 |
| `/api/music-vip-membership/client/vip/info` | 读取会员信息 |
| `/api/user/playlist` | 分页读取已创建、已收藏及喜欢歌单 |
| `/api/v6/playlist/detail` | 获取完整曲目 ID 索引 |
| `/api/v3/song/detail` | 批量补齐曲目详情和搜索封面，保持原始排序 |
| `/api/search/get` | 分页搜索单曲 |
| `/api/song/enhance/player/url/v1` | 获取当前账号的逐曲播放授权 |
| `/api/song/lyric/v1` | 获取歌词，使用公共 LRC / YRC 解析器 |

请求至少间隔 500ms，认证失败、风控或限流会停止后台同步。封面使用缩略图尺寸，图片和音频请求不携带账号 Cookie。歌词、队列与索引复用公共音乐模块。

## 音质与播放

| 接口 level | 显示名称 |
| --- | --- |
| `standard` | 标准 |
| `higher` | 较高 |
| `exhigh` | 极高 |
| `lossless` | 无损 |
| `hires` | Hi-Res |
| `jyeffect` | 高清臻音 |
| `sky` | 沉浸环绕 |
| `jymaster` | 超清母带 |
| `dolby` | 杜比全景声 |
| `vivid` | 臻音全景声 |

自动选择按表格逆序检查，实际档位取决于单曲授权和解码支持。高级请求返回低档位时继续检查中间档位。`vivid` 请求 MP3，其余请求 FLAC；仅接受同一歌曲的完整音源，拒绝试听和权限不足的响应。当前支持 MP3 / FLAC，不提供空间音频渲染。

首次选择当前可用音质不显示降级；已选资源播放或解码失败后的切换才显示降级。编码、采样率、位深和声道以实际资源为准。

## 实现与验证

- `src-tauri/src/music/netease.rs`：会话校验、读取、封面与播放授权。
- `src-tauri/src/music/netease_quality.rs`：音质映射、授权检查和格式识别。
- `src-tauri/src/music/login.rs`：官方登录窗口生命周期。
- `tests/music-recovery.spec.ts`、`tests/music-readonly.spec.ts`：登录恢复、会员状态、只读歌单及本地播放操作回归。
