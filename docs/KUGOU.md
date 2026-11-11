# 酷狗账号与播放接入

开放 `qr-login`、`account`、`search`、`lyrics`、`playlists`、`playback`，播放支持 128 kbps 标准 MP3。Rust Provider 使用官网会话直连 H5 网关。

## 已接入接口

| 用途 | 官网接口 | 验证与产品处理 |
| --- | --- | --- |
| 获取二维码 | `GET login-user.kugou.com/v2/qrcode` | 官网 H5 参数，原生生成二维码图片 |
| 扫码确认 | `GET login-user.kugou.com/v2/get_userinfo_qrcode` | 处理等待、已扫码、确认、过期；取消与切换后旧请求不能附加账号 |
| 网页会话交换、账号恢复 | `POST loginservice.kugou.com/v1/login_by_token_get` | 空请求体，官网 AES / RSA 参数和 H5 签名；验证返回账号与官网 Cookie 的账号一致 |
| 全站搜索 | `GET complexsearch.kugou.com/v2/search/song` | 官网 `WebFilter`、`appid=1014`、`srcappid=2919`、`clientver=1000`；严格解析 JSONP，不执行脚本 |
| 歌词与版本确认 | `GET wwwapi.kugou.com/play/songinfo` | 官网 `platid=4`、`clientver=20000`，使用搜索返回的 `EMixSongID`；同时核对 hash 与编码版本 ID |
| 当前账号歌单 | `POST gateway.kugou.com/v7/get_all_list` | H5 签名包含实际 JSON 请求体，`x-router: cloudlist.service.kugou.com`；核对账号与分页版本 |
| 歌单歌曲 | `POST gateway.kugou.com/v4/get_list_all_file` | 当前账号的 `listid`，固定 50 条分页；核对账号、歌单、页码、总数、版本；兼容空歌单 `info: null` |
| 完整播放取址 | `GET gateway.kugou.com/v5/url` | `x-router: trackercdn.kugou.com`，H5 `appid=1014`，精确版本及 hash；请求完整标准音质，由服务器决定授权 |
| 封面 | 酷狗固定图片域名 | 独立请求，不携带账号 Cookie；限制类型、大小及跳转 |

搜索与歌曲信息请求使用交换后的官网 token，并按作用域发送 Cookie。`mid`、`dfid` 使用实际会话字段，不模拟官网风控指纹。H5 签名采用官网公开脚本的固定盐与排序参数。版本标识为 `FileHash_EMixSongID`，保留完整版本标题。分页按服务端原始行跨度前进，过滤不可用行仍计入跨度，支持跨官网 30 条分页边界的偏移。

界面开放已创建及已收藏歌单的读取、我喜欢、平台搜索、播放和本地队列，使用公共播放器、歌词缓存、进度与响度处理。歌单以创建账号区分创建/收藏，当前账号的 `is_def=2` 识别我喜欢，不用同名普通歌单代替。后台索引支持分页同步。歌曲菜单仅保留播放、本地队列、歌词和封面操作。搜索保留编码版本，歌单保留数值 `mixsongid`，歌词按对应版本校验。

播放响应必须 `status=1`、`priv_status=1`，hash 一致，完整时长与曲目差异不超过两秒，且文件大小、格式、码率有效。试听标记、短片段、未知音频服务器与版本不一致均拒绝。音频 CDN 使用不含 Cookie 的独立客户端，禁用跳转，固定 HTTPS 主机；真实 MP3 帧决定采样率和声道。沿用原生内存分段传输、回环播放凭证、预加载及取消机制；远程签名地址不进入前端、数据库或日志。

## 回归入口

原生显式只读测试使用 stdin 接收临时会话；界面回归见 `tests/music-kugou.spec.ts` 和 `tests/music-readonly.spec.ts`。

## 暂未开放

官网歌曲信息含 `play_url`，但样本同时标记 `is_free_part=1`，该地址仍被立即丢弃；完整播放改用已经验证的 H5 tracker 授权。当前仅开放标准 MP3，不宣称已经验证会员歌曲、高品质、无损或所有曲目的可播性。每曲授权失败时显示实际受限状态，不把登录成功当作获得全部曲库权限。

## 会话与边界

凭据仅保存在原生端独立的 `kugou-session.dpapi` 中；恢复和刷新账号通过官网交换接口验证，不信任缓存昵称。取消登录和最终凭据写入共用代次与账号门控。扫码主流程不会读取已安装客户端的凭据。接口固定在明确的 HTTPS 来源与路径，禁用跳转；响应与图片均设大小上限。

安全验证响应与限流会停止当前请求，不自动重试或生成验证凭据。用户可在受限官网窗口完成验证，再刷新二维码；尚未证明独立浏览器验证能够恢复原生会话。该窗口使用独立目录，不导入其 Cookie。

监听记录仅保留接口域名、路径、方法、参数名及脱敏验证结果。不保存 Cookie、token、用户 ID、私人资料 HTML、歌词正文或签名媒体地址。
