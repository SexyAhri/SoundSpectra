//! Kugou website login, read-only library and playback. See docs/KUGOU.md.
use super::model::*;
use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD, Engine};
use md5::{Digest, Md5};
use num_bigint::BigUint;
use reqwest::{
    blocking::Client,
    cookie::{CookieStore, Jar},
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    io::Read,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const WEB_SALT: &str = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
const MODULUS: &str = "B1B1EC76A1BBDBF0D18E8CD9A87E53FA3881E2F004C67C9DDA2CA677DBEFA3D61DF8463FE12D84FF4B4699E02C9D41CAB917F5A8FB9E35580C4BDF97763A0420A476295D763EE10174E6F9EBF7DF8A77BA5B20CDA4EE705DEF5BBA3C88567B9656E52C9CD5CD95CA735FF2D25F762B133273EEEB7B4F3EA8B6DA29040F3B67CD";
const EXCHANGE: &str = "https://loginservice.kugou.com/v1/login_by_token_get";
const MAX_JSON: u64 = 2 * 1024 * 1024;
type Params = BTreeMap<String, String>;

#[derive(Serialize, Deserialize)]
pub struct Session {
    token: String,
    userid: u64,
    mid: String,
    // Original Set-Cookie records are reconstructed using the exact HTTPS
    // response origin, retaining Domain/Path/Secure/Expires restrictions.
    cookies: Vec<String>,
    nickname: String,
    avatar: Option<String>,
    #[serde(skip)]
    freshly_validated: bool,
}
impl Session {
    pub fn validate(&mut self) -> Result<(), String> {
        if !self.freshly_validated {
            *self = exchange(&self.token, self.userid, &self.mid, &self.cookies)?;
        }
        Ok(())
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn md5(value: impl AsRef<[u8]>) -> String {
    hex(&Md5::digest(value.as_ref()))
}
fn number(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}
fn params(rows: &[(&str, String)]) -> Params {
    rows.iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}
fn signature(query: &Params, salt: &str) -> String {
    let mut input = salt.to_string();
    for (key, value) in query {
        input.push_str(key);
        input.push('=');
        input.push_str(value);
    }
    input.push_str(salt);
    md5(input)
}
fn query_url(url: &str, query: &Params) -> Result<Url, String> {
    let mut url = Url::parse(url).map_err(|_| "酷狗接口地址无效")?;
    url.query_pairs_mut().extend_pairs(query);
    Ok(url)
}
pub(super) fn random_mid() -> Result<String, String> {
    let mut bytes = [0; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| "无法创建酷狗会话")?;
    Ok(md5(bytes))
}
fn valid_mid(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn credential(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 4096
        && value
            .bytes()
            .all(|b| (0x21..0x7f).contains(&b) && b != b';')
}
fn network(jar: Option<Arc<Jar>>) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(18))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    if let Some(jar) = jar {
        builder = builder.cookie_provider(jar);
    }
    builder.build().map_err(|_| "无法创建酷狗网络会话".into())
}
fn response_bytes(response: reqwest::blocking::Response) -> Result<Vec<u8>, String> {
    if response.headers().contains_key("SSA-CODE") || response.headers().contains_key("SSA-HMID") {
        return Err("[risk] 酷狗需要官方安全验证，请打开官方授权窗口，完成后刷新二维码".into());
    }
    if response.status().as_u16() == 429 {
        return Err("[rate_limit] 酷狗请求过于频繁，请稍后重试".into());
    }
    if !response.status().is_success() {
        return Err("酷狗服务暂时不可用，请稍后重试".into());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_JSON + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取酷狗响应失败")?;
    if bytes.len() as u64 > MAX_JSON {
        return Err("酷狗响应超过大小限制".into());
    }
    Ok(bytes)
}
fn response(response: reqwest::blocking::Response) -> Result<Value, String> {
    serde_json::from_slice(&response_bytes(response)?).map_err(|_| "酷狗响应格式发生变化".into())
}
fn business(value: &Value, expected: u64) -> Result<(), String> {
    if number(&value["error_code"]) == Some(20028) {
        return Err("[risk] 酷狗需要官方安全验证，请打开官网完成后重试".into());
    }
    if number(&value["status"]) == Some(expected) {
        Ok(())
    } else {
        Err("酷狗未授权此项请求，请刷新或重新扫码".into())
    }
}
fn web_request(
    client: &Client,
    url: &str,
    mut query: Params,
    post: bool,
) -> Result<(Value, Vec<String>), String> {
    query.insert("signature".into(), signature(&query, WEB_SALT));
    let url = query_url(url, &query)?;
    let request = if post {
        client.post(url).body(Vec::new())
    } else {
        client.get(url)
    };
    let reply = request
        .header("Origin", "https://login-user.kugou.com")
        .header("Referer", "https://login-user.kugou.com/")
        .send()
        .map_err(|_| "连接酷狗登录服务失败")?;
    let cookies = reply
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .filter(|h| h.len() <= 16384)
        .take(64)
        .map(str::to_owned)
        .collect();
    Ok((response(reply)?, cookies))
}
fn web_base(mid: &str) -> Params {
    params(&[
        ("appid", "1014".into()),
        ("clientver", "20000".into()),
        ("clienttime", super::now().to_string()),
        ("mid", mid.into()),
        ("uuid", mid.into()),
        ("dfid", "-".into()),
        ("plat", "4".into()),
        ("srcappid", "2919".into()),
    ])
}

pub(super) struct QrLogin {
    client: Client,
    mid: String,
    key: String,
    pub image: String,
}
impl QrLogin {
    pub fn create() -> Result<Self, String> {
        let mid = random_mid()?;
        let client = network(None)?;
        let mut query = web_base(&mid);
        query.insert("type".into(), "1".into());
        query.insert(
            "qrcode_txt".into(),
            "https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1014&".into(),
        );
        let (value, _) = web_request(
            &client,
            "https://login-user.kugou.com/v2/qrcode",
            query,
            false,
        )?;
        business(&value, 1)?;
        let key = value["data"]["qrcode"]
            .as_str()
            .filter(|s| credential(s) && s.len() < 1024)
            .ok_or("酷狗未返回有效二维码")?
            .to_string();
        let mut url =
            Url::parse("https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1014").unwrap();
        url.query_pairs_mut().append_pair("qrcode", &key);
        let code = qrcode::QrCode::new(url.as_str()).map_err(|_| "无法生成酷狗二维码")?;
        let width = (code.width() + 8) * 5;
        let mut pixels = vec![255; width * width];
        for y in 0..code.width() {
            for x in 0..code.width() {
                if code[(x, y)] == qrcode::Color::Dark {
                    for dy in 0..5 {
                        for dx in 0..5 {
                            pixels[((y + 4) * 5 + dy) * width + (x + 4) * 5 + dx] = 0;
                        }
                    }
                }
            }
        }
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, width as u32, width as u32);
            encoder.set_color(png::ColorType::Grayscale);
            let mut writer = encoder.write_header().map_err(|_| "无法绘制二维码")?;
            writer
                .write_image_data(&pixels)
                .map_err(|_| "无法绘制二维码")?;
        }
        let image = format!("data:image/png;base64,{}", STANDARD.encode(png));
        Ok(Self {
            client,
            mid,
            key,
            image,
        })
    }
    pub fn poll(&self) -> Result<(u64, Option<Session>), String> {
        let mut query = web_base(&self.mid);
        query.insert("qrcode".into(), self.key.clone());
        let (value, _) = web_request(
            &self.client,
            "https://login-user.kugou.com/v2/get_userinfo_qrcode",
            query,
            false,
        )?;
        business(&value, 1)?;
        let data = &value["data"];
        let phase = number(&data["status"]).ok_or("酷狗扫码状态无效")?;
        match phase {
            4 => {
                let userid = number(&data["userid"])
                    .filter(|id| *id > 0)
                    .ok_or("酷狗账号校验失败")?;
                let token = data["token"]
                    .as_str()
                    .filter(|s| credential(s))
                    .ok_or("酷狗登录凭据无效")?;
                Ok((phase, Some(exchange(token, userid, &self.mid, &[])?)))
            }
            0..=2 => Ok((phase, None)),
            _ => Err("酷狗扫码状态发生变化，请刷新二维码".into()),
        }
    }
}

fn encrypted_token(token: &str, seed: &str) -> Result<String, String> {
    let key = md5(seed);
    let plain = serde_json::to_vec(&json!({"token":token})).map_err(|_| "无法编码酷狗登录请求")?;
    let length = plain.len();
    let mut buffer = plain;
    buffer.resize(length + 16, 0);
    let cipher =
        cbc::Encryptor::<aes::Aes256>::new_from_slices(key.as_bytes(), &key.as_bytes()[16..])
            .map_err(|_| "无法编码酷狗登录请求")?;
    let bytes = cipher
        .encrypt_padded_mut::<Pkcs7>(&mut buffer, length)
        .map_err(|_| "无法编码酷狗登录请求")?;
    Ok(hex(bytes))
}
fn rsa_key(time: u64, seed: &str) -> Result<String, String> {
    // Official web wire format: ASCII JSON, zero padding on the right, raw RSA.
    let mut bytes = format!("{{\"clienttime_ms\":{time},\"key\":\"{seed}\"}}").into_bytes();
    if bytes.len() > 128 || !seed.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("酷狗登录参数无效".into());
    }
    bytes.resize(128, 0);
    let modulus = BigUint::parse_bytes(MODULUS.as_bytes(), 16).ok_or("酷狗公钥无效")?;
    let result = BigUint::from_bytes_be(&bytes)
        .modpow(&BigUint::from(65537u32), &modulus)
        .to_str_radix(16);
    Ok(format!(
        "{:0>width$}",
        result,
        width = result.len().div_ceil(4) * 4
    ))
}
fn seed() -> Result<String, String> {
    let mut result = String::new();
    while result.len() < 16 {
        let mut byte = [0];
        getrandom::getrandom(&mut byte).map_err(|_| "无法创建酷狗会话")?;
        if byte[0] < 252 {
            result.push(b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[(byte[0] % 36) as usize] as char);
        }
    }
    Ok(result)
}
fn jar(cookies: &[String]) -> Arc<Jar> {
    let jar = Arc::new(Jar::default());
    let url = Url::parse(EXCHANGE).unwrap();
    for cookie in cookies.iter().filter(|c| c.len() <= 16384).take(64) {
        jar.add_cookie_str(cookie, &url);
    }
    jar
}
fn website_cookies(jar: &Jar) -> HashMap<String, String> {
    jar.cookies(&Url::parse("https://www.kugou.com/").unwrap())
        .and_then(|h| h.to_str().ok().map(str::to_owned))
        .unwrap_or_default()
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}
fn cookie_identity(cookies: &HashMap<String, String>) -> Option<u64> {
    let compound = cookies.get("KuGoo")?.trim_matches('"');
    // form decoding a single wrapper value performs percent decoding without
    // accidentally treating the compound cookie's ampersands as separators.
    let wrapped = format!("value={}", compound.replace('&', "%26").replace('+', "%2B"));
    let decoded = reqwest::Url::parse(&format!("https://www.kugou.com/?{wrapped}"))
        .ok()?
        .query_pairs()
        .next()?
        .1
        .to_string();
    decoded.split('&').find_map(|part| {
        part.split_once('=')
            .filter(|(k, _)| *k == "KugooID")
            .and_then(|(_, v)| v.parse().ok())
    })
}
fn exchange(token: &str, userid: u64, mid: &str, cookies: &[String]) -> Result<Session, String> {
    if !credential(token) || userid == 0 || !valid_mid(mid) {
        return Err("[authentication] 酷狗登录凭据无效，请重新扫码".into());
    }
    let jar = jar(cookies);
    let client = network(Some(jar.clone()))?;
    let time = super::now();
    let seed = seed()?;
    let mut query = web_base(mid);
    for (key, value) in [
        ("clientver", "1000".into()),
        ("clienttime", (time / 1000).to_string()),
        ("dev", "web".into()),
        ("userid", userid.to_string()),
        ("clienttime_ms", time.to_string()),
        ("params", encrypted_token(token, &seed)?),
        ("pk", rsa_key(time, &seed)?),
    ] {
        query.insert(key.into(), value);
    }
    let (value, received) = web_request(&client, EXCHANGE, query, true)?;
    business(&value, 1).map_err(|_| "[authentication] 酷狗登录已失效，请重新扫码")?;
    let data = &value["data"];
    let fields = website_cookies(&jar);
    if number(&data["userid"]) != Some(userid) || cookie_identity(&fields) != Some(userid) {
        return Err("[authentication] 酷狗登录账号校验不一致，请重新扫码".into());
    }
    let token = fields
        .get("t")
        .filter(|s| credential(s))
        .ok_or("酷狗未建立有效官网会话，请重新扫码")?
        .clone();
    let nickname = data["nickname"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("酷狗用户")
        .chars()
        .take(128)
        .collect();
    let avatar = data["pic"].as_str().and_then(asset).map(|u| u.to_string());
    Ok(Session {
        token,
        userid,
        mid: mid.into(),
        cookies: if received.is_empty() {
            cookies.to_vec()
        } else {
            received
        },
        nickname,
        avatar,
        freshly_validated: true,
    })
}

pub struct Kugou {
    session: Mutex<Session>,
    client: Client,
    cache: Option<Arc<super::cache::Cache>>,
    playlists: Mutex<Option<PlaylistIndex>>,
    prepared: Mutex<Option<super::kugou_audio::Prepared>>,
}

struct PlaylistIndex {
    at: Instant,
    rows: Vec<Value>,
}
impl Kugou {
    pub fn new(session: &Session) -> Result<Self, String> {
        if !credential(&session.token)
            || !valid_mid(&session.mid)
            || session.userid == 0
            || cookie_identity(&website_cookies(&jar(&session.cookies))) != Some(session.userid)
        {
            return Err("[authentication] 酷狗登录会话已失效，请重新扫码".into());
        }
        Ok(Self {
            session: Mutex::new(Session {
                token: session.token.clone(),
                userid: session.userid,
                mid: session.mid.clone(),
                cookies: session.cookies.clone(),
                nickname: session.nickname.clone(),
                avatar: session.avatar.clone(),
                freshly_validated: session.freshly_validated,
            }),
            client: network(None)?,
            cache: None,
            playlists: Mutex::new(None),
            prepared: Mutex::new(None),
        })
    }

    pub fn with_cache(mut self, cache: Arc<super::cache::Cache>) -> Self {
        self.cache = Some(cache);
        self
    }

    fn context(&self, search: bool) -> (Params, Arc<Jar>) {
        {
            let session = self.session.lock().unwrap();
            let cookies = jar(&session.cookies);
            let fields = website_cookies(&cookies);
            let mid = fields
                .get("kg_mid")
                .filter(|s| valid_mid(s))
                .map(String::as_str)
                .unwrap_or(&session.mid);
            let dfid = fields
                .get("kg_dfid")
                .or_else(|| fields.get("dfid"))
                .filter(|s| credential(s))
                .map(String::as_str)
                .unwrap_or("-");
            let query = params(&[
                ("srcappid", "2919".into()),
                ("clientver", if search { "1000" } else { "20000" }.into()),
                ("clienttime", super::now().to_string()),
                ("mid", mid.into()),
                ("uuid", mid.into()),
                ("dfid", dfid.into()),
                ("appid", "1014".into()),
                ("userid", session.userid.to_string()),
                ("token", session.token.clone()),
            ]);
            (query, cookies)
        }
    }

    fn web(&self, host: &str, path: &str, extra: Params, search: bool) -> Result<Value, String> {
        let (mut query, cookies) = self.context(search);
        query.extend(extra);
        query.insert("signature".into(), signature(&query, WEB_SALT));
        // Both origins were observed on the official website. Credentials use
        // the cookie store's scope rules; redirects are disabled by the client.
        if !matches!(
            (host, path),
            ("complexsearch.kugou.com", "/v2/search/song") | ("wwwapi.kugou.com", "/play/songinfo")
        ) {
            return Err("酷狗网页接口尚未接入".into());
        }
        let url = query_url(&format!("https://{host}{path}"), &query)?;
        let mut request = self
            .client
            .get(url.clone())
            .header("Referer", "https://www.kugou.com/");
        if let Some(cookie) = cookies.cookies(&url) {
            request = request.header(reqwest::header::COOKIE, cookie);
        }
        let reply = request.send().map_err(|_| "连接酷狗网页服务失败")?;
        let bytes = response_bytes(reply)?;
        let value = if search {
            jsonp(&bytes)?
        } else {
            serde_json::from_slice(&bytes).map_err(|_| "酷狗网页响应格式发生变化")?
        };
        business(&value, 1)?;
        if number(&value["error_code"])
            .or_else(|| number(&value["err_code"]))
            .is_some_and(|e| e != 0)
        {
            return Err("酷狗网页未授权此项数据".into());
        }
        Ok(value)
    }

    fn song_info(&self, track: &Track) -> Result<Value, String> {
        let (hash, encoded) = locator(track)?;
        let numeric = track.id.ends_with(&format!("_n{}", track.numeric_id));
        let mut query = params(&[("platid", "4".into())]);
        if numeric && track.numeric_id > 0 {
            query.insert("album_audio_id".into(), track.numeric_id.to_string());
            query.insert("hash".into(), hash.into());
        } else {
            query.insert("encode_album_audio_id".into(), encoded.into());
        }
        let value = self.web("wwwapi.kugou.com", "/play/songinfo", query, false)?;
        let data = &value["data"];
        // Cloud-list hashes may represent an older encoding of this version.
        // Lyrics use the exact numeric version, never a title-based replacement.
        let same = if numeric {
            number(&data["album_audio_id"]) == Some(track.numeric_id)
        } else {
            data["hash"]
                .as_str()
                .is_some_and(|s| s.eq_ignore_ascii_case(hash))
                && data["encode_album_audio_id"].as_str() == Some(encoded)
        };
        if !same {
            return Err("酷狗返回的歌曲版本不一致，请重新搜索".into());
        }
        // Do not keep any signed media URL in the provider or shared cache.
        Ok(serde_json::json!({"lyrics":data["lyrics"],"img":data["img"]}))
    }

    fn gateway(&self, path: &str, mut extra: Params, body: Option<Value>) -> Result<Value, String> {
        let router = match path {
            "/v7/get_all_list" | "/v4/get_list_all_file" if body.is_some() => {
                "cloudlist.service.kugou.com"
            }
            "/v5/url" if body.is_none() => "trackercdn.kugou.com",
            _ => return Err("酷狗接口尚未接入".into()),
        };
        let (mut query, cookies) = self.context(false);
        query.insert("uuid".into(), query["clienttime"].clone());
        query.append(&mut extra);
        let body = body.map(|b| b.to_string());
        let mut input = WEB_SALT.to_string();
        for (key, value) in &query {
            input.push_str(key);
            input.push('=');
            input.push_str(value);
        }
        input.push_str(body.as_deref().unwrap_or_default());
        input.push_str(WEB_SALT);
        query.insert("signature".into(), md5(input));
        let url = query_url(&format!("https://gateway.kugou.com{path}"), &query)?;
        let mut request = if let Some(body) = body {
            self.client
                .post(url.clone())
                .header("Content-Type", "application/json")
                .body(body)
        } else {
            self.client.get(url.clone())
        }
        .header("Referer", "https://www.kugou.com/")
        .header("x-router", router);
        if let Some(cookie) = cookies.cookies(&url) {
            request = request.header(reqwest::header::COOKIE, cookie);
        }
        let value = response(request.send().map_err(|_| "连接酷狗服务失败")?)?;
        if number(&value["error_code"]) == Some(20028) {
            return Err("[risk] 酷狗要求官方安全验证，请稍后手动重试".into());
        }
        // Tracker status=2 is an ordinary per-song denial, not a logged-out account.
        if path != "/v5/url" {
            business(&value, 1)?;
            if number(&value["error_code"]).is_some_and(|n| n != 0) {
                return Err("酷狗未授权此项数据".into());
            }
        }
        Ok(value)
    }

    fn playlist_index(&self) -> Result<Vec<Value>, String> {
        let mut index = self.playlists.lock().unwrap();
        if let Some(index) = index
            .as_ref()
            .filter(|i| i.at.elapsed() < Duration::from_secs(15))
        {
            return Ok(index.rows.clone());
        }
        let (userid, token) = {
            let session = self.session.lock().unwrap();
            (session.userid, session.token.clone())
        };
        let mut rows = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut version = None;
        for page in 1..=200 {
            let value = self.gateway(
                "/v7/get_all_list",
                params(&[("plat", "1".into())]),
                Some(json!({
                    "userid":userid,"token":token,"total_ver":979,"type":2,"page":page,"pagesize":50
                })),
            )?;
            let data = &value["data"];
            if number(&data["userid"]) != Some(userid) {
                return Err("[authentication] 酷狗歌单账号不一致，请重新登录".into());
            }
            let current = number(&data["total_ver"]).ok_or("酷狗歌单版本无效")?;
            if *version.get_or_insert(current) != current {
                return Err("酷狗歌单已更新，请刷新后重试".into());
            }
            let chunk = data["info"]
                .as_array()
                .filter(|v| v.len() <= 50)
                .ok_or("酷狗歌单响应发生变化")?;
            for row in chunk {
                let id = number(&row["listid"])
                    .filter(|id| *id > 0)
                    .ok_or("酷狗歌单标识无效")?;
                if !seen.insert(id) {
                    return Err("酷狗歌单分页重复，请刷新后重试".into());
                }
                rows.push(row.clone());
            }
            if chunk.len() < 50 {
                *index = Some(PlaylistIndex {
                    at: Instant::now(),
                    rows: rows.clone(),
                });
                return Ok(rows);
            }
        }
        Err("酷狗歌单数量超过单次同步上限".into())
    }

    fn list_id(&self, playlist: &str) -> Result<u64, String> {
        let rows = self.playlist_index()?;
        let userid = self.session.lock().unwrap().userid;
        let row = rows
            .iter()
            .find(|row| {
                if playlist == "liked" {
                    number(&row["is_def"]) == Some(2)
                        && number(&row["list_create_userid"]) == Some(userid)
                } else {
                    number(&row["listid"]).is_some_and(|id| id.to_string() == playlist)
                }
            })
            .ok_or("酷狗账号中未找到此歌单，请刷新歌单")?;
        number(&row["listid"]).ok_or_else(|| "酷狗歌单标识无效".into())
    }
}

fn jsonp(bytes: &[u8]) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "酷狗网页响应编码无效")?
        .trim();
    let text = text.strip_suffix(';').unwrap_or(text).trim();
    let body = text
        .strip_prefix("callback123(")
        .and_then(|s| s.strip_suffix(')'))
        .ok_or("酷狗网页搜索响应格式发生变化")?;
    serde_json::from_str(body).map_err(|_| "酷狗网页搜索响应格式发生变化".into())
}
fn clean(value: &Value) -> String {
    let stripped = regex::Regex::new(r"<[^>]*>")
        .unwrap()
        .replace_all(value.as_str().unwrap_or_default(), "");
    stripped
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .chars()
        .take(1024)
        .collect()
}
fn encoded_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.bytes().all(|b| b.is_ascii_alphanumeric())
}
fn web_track(value: &Value) -> Option<Track> {
    let hash = value["FileHash"].as_str()?.to_lowercase();
    let encoded = value["EMixSongID"].as_str()?;
    if !valid_mid(&hash) || !encoded_id(encoded) {
        return None;
    }
    let title = clean(&value["SongName"]);
    if title.is_empty() {
        return None;
    }
    Some(Track {
        id: format!("{hash}_{encoded}"),
        provider: "kugou".into(),
        title,
        artist: clean(&value["SingerName"]),
        album: clean(&value["AlbumName"]),
        cover: value["Image"]
            .as_str()
            .or_else(|| value["AlbumImage"].as_str())
            .and_then(asset)
            .map(|u| u.to_string()),
        duration: value["Duration"]
            .as_f64()
            .filter(|n| n.is_finite() && *n >= 0.0 && *n < 86400.0)
            .unwrap_or(0.0),
        paid: number(&value["PayType"]).is_some_and(|n| n > 0),
        numeric_id: number(&value["MixSongID"]).unwrap_or(0),
        media_id: number(&value["AlbumID"]).unwrap_or(0).to_string(),
        audio_sizes: HashMap::new(),
    })
}
fn locator(track: &Track) -> Result<(&str, &str), String> {
    let (hash, encoded) = track.id.split_once('_').ok_or("酷狗歌曲标识无效")?;
    if track.provider != "kugou" || !valid_mid(hash) || !encoded_id(encoded) {
        return Err("酷狗歌曲标识无效".into());
    }
    Ok((hash, encoded))
}

fn cloud_track(value: &Value) -> Option<Track> {
    let hash = value["hash"].as_str()?.to_lowercase();
    let id = number(&value["mixsongid"]).filter(|id| *id > 0)?;
    if !valid_mid(&hash) {
        return None;
    }
    let artist = value["singerinfo"]
        .as_array()
        .map(|singers| {
            singers
                .iter()
                .map(|s| clean(&s["name"]))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .unwrap_or_default();
    let name = clean(&value["name"]);
    let title = name
        .strip_prefix(&format!("{artist} - "))
        .unwrap_or(&name)
        .to_string();
    let duration = number(&value["timelen"])? as f64 / 1000.0;
    if title.is_empty() || !(0.0..86400.0).contains(&duration) {
        return None;
    }
    Some(Track {
        id: format!("{hash}_n{id}"),
        provider: "kugou".into(),
        title,
        artist,
        album: clean(&value["albuminfo"]["name"]),
        cover: value["cover"]
            .as_str()
            .and_then(asset)
            .map(|u| u.to_string()),
        duration,
        paid: number(&value["media_pay_type"]).is_some_and(|n| n > 0),
        numeric_id: id,
        media_id: number(&value["album_id"])
            .or_else(|| number(&value["albuminfo"]["id"]))
            .unwrap_or(0)
            .to_string(),
        audio_sizes: HashMap::new(),
    })
}

fn cloud_rows(data: &Value) -> Result<&[Value], String> {
    match data["info"].as_array() {
        Some(rows) if rows.len() <= 50 => Ok(rows),
        None if data["info"].is_null() && number(&data["count"]) == Some(0) => Ok(&[]),
        _ => Err("酷狗歌曲响应发生变化".into()),
    }
}

fn asset(value: &str) -> Option<Url> {
    let mut url = Url::parse(&value.replace("{size}", "240")).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
        || !url.host_str().is_some_and(|h| {
            matches!(
                h,
                "imge.kugou.com"
                    | "imgessl.kugou.com"
                    | "singerimg.kugou.com"
                    | "singerimgssl.kugou.com"
            )
        })
    {
        return None;
    }
    url.set_scheme("https").ok()?;
    url.set_fragment(None);
    Some(url)
}
impl Provider for Kugou {
    fn id(&self) -> &'static str {
        "kugou"
    }
    fn name(&self) -> &'static str {
        "酷狗音乐"
    }
    fn refreshed_session(&self) -> Result<Option<Vec<u8>>, String> {
        serde_json::to_vec(&*self.session.lock().unwrap())
            .map(Some)
            .map_err(|_| "无法保存酷狗会话".into())
    }
    fn scope(&self) -> String {
        format!(
            "kugou-{}",
            super::cache::scope(&self.session.lock().unwrap().userid.to_string())
        )
    }
    fn capabilities(&self) -> &'static [&'static str] {
        &[
            "qr-login",
            "account",
            "search",
            "lyrics",
            "playlists",
            "playback",
        ]
    }
    fn discard_prefetch(&self) {
        self.prepared.lock().unwrap().take();
    }
    fn account(&self) -> Result<Account, String> {
        let mut session = self.session.lock().unwrap();
        if !session.freshly_validated {
            *session = exchange(
                &session.token,
                session.userid,
                &session.mid,
                &session.cookies,
            )?;
        }
        session.freshly_validated = false;
        Ok(Account {
            provider: "kugou".into(),
            nickname: session.nickname.clone(),
            avatar: session.avatar.clone(),
            membership: None,
            membership_issue: Some("会员权限以酷狗官方显示为准".into()),
        })
    }
    fn search(&self, query: &str, offset: usize, limit: usize) -> Result<Page<Track>, String> {
        if query.trim().is_empty()
            || query.len() > 512
            || offset > 100_000
            || !(1..=100).contains(&limit)
        {
            return Err("酷狗搜索参数无效".into());
        }
        let mut position = offset;
        let mut items = Vec::new();
        let mut filtered = 0;
        let mut expected_total = None;
        let total;
        loop {
            let page = position / 30 + 1;
            let value = self.web(
                "complexsearch.kugou.com",
                "/v2/search/song",
                params(&[
                    ("callback", "callback123".into()),
                    ("keyword", query.into()),
                    ("page", page.to_string()),
                    ("pagesize", "30".into()),
                    ("bitrate", "0".into()),
                    ("isfuzzy", "0".into()),
                    ("inputtype", "0".into()),
                    ("platform", "WebFilter".into()),
                    ("iscorrection", "1".into()),
                    ("privilege_filter", "0".into()),
                    ("filter", "10".into()),
                ]),
                true,
            )?;
            let data = &value["data"];
            if number(&data["page"]) != Some(page as u64) {
                return Err("酷狗网页搜索分页发生变化，请重新搜索".into());
            }
            let count = number(&data["total"]).ok_or("酷狗搜索响应无效")? as usize;
            if *expected_total.get_or_insert(count) != count {
                return Err("酷狗搜索结果已变化，请重新搜索".into());
            }
            let rows = data["lists"]
                .as_array()
                .filter(|r| r.len() <= 30)
                .ok_or("酷狗搜索响应无效")?;
            let skip = position % 30;
            let take = (limit - (position - offset)).min(rows.len().saturating_sub(skip));
            for row in rows.iter().skip(skip).take(take) {
                if let Some(t) = web_track(row) {
                    items.push(t);
                } else {
                    filtered += 1;
                }
            }
            position += take;
            if position - offset >= limit || position >= count {
                total = count;
                break;
            }
            if rows.len() < 30 || take == 0 {
                return Err("酷狗网页返回的搜索分页不完整，请重试".into());
            }
        }
        Ok(Page {
            items,
            total,
            next_offset: (position < total).then_some(position),
            filtered,
        })
    }
    fn lyrics(&self, track: &Track) -> Result<String, String> {
        let value = self.song_info(track)?;
        let text = value["lyrics"]
            .as_str()
            .filter(|s| s.len() <= MAX_JSON as usize)
            .ok_or("酷狗网页暂未提供此版本的歌词")?;
        if crate::lyrics::parse(text)?.is_empty() {
            return Err("酷狗网页暂未提供有效的时间轴歌词".into());
        }
        Ok(text.to_string())
    }
    fn artwork(&self, value: &str) -> Option<String> {
        let url = asset(value)?;
        let reply = self.client.get(url).send().ok()?;
        if !reply.status().is_success() {
            return None;
        }
        let mime = reply
            .headers()
            .get(reqwest::header::CONTENT_TYPE)?
            .to_str()
            .ok()?
            .split(';')
            .next()?
            .to_string();
        if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") {
            return None;
        }
        let mut bytes = Vec::new();
        reply
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() > 2 * 1024 * 1024 || bytes.is_empty() {
            return None;
        }
        Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }
    fn playlists(
        &self,
        collection: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Page<Playlist>, String> {
        if !matches!(collection, "created" | "collected")
            || offset > 100_000
            || !(1..=100).contains(&limit)
        {
            return Err("酷狗歌单参数无效".into());
        }
        let userid = self.session.lock().unwrap().userid;
        let rows: Vec<_> = self
            .playlist_index()?
            .into_iter()
            .filter(|r| number(&r["is_del"]).unwrap_or(0) == 0)
            .filter(|r| {
                (number(&r["list_create_userid"]) == Some(userid)) == (collection == "created")
            })
            .collect();
        let total = rows.len();
        let span = total.saturating_sub(offset).min(limit);
        let items: Vec<_> = rows
            .iter()
            .skip(offset)
            .take(span)
            .filter_map(|row| {
                let name = clean(&row["name"]);
                if name.is_empty() {
                    return None;
                }
                Some(Playlist {
                    id: number(&row["listid"])?.to_string(),
                    name,
                    cover: row["pic"].as_str().and_then(asset).map(|u| u.to_string()),
                    count: number(&row["count"]).unwrap_or(0) as usize,
                })
            })
            .collect();
        Ok(Page {
            filtered: span - items.len(),
            items,
            total,
            next_offset: (offset + span < total).then_some(offset + span),
        })
    }
    fn tracks(&self, playlist: &str, offset: usize, limit: usize) -> Result<Page<Track>, String> {
        if offset > 100_000 || !(1..=100).contains(&limit) {
            return Err("酷狗歌单分页参数无效".into());
        }
        let listid = self.list_id(playlist)?;
        let (userid, token) = {
            let session = self.session.lock().unwrap();
            (session.userid, session.token.clone())
        };
        let mut position = offset;
        let mut items = Vec::new();
        let mut expected = None;
        loop {
            let page = position / 50 + 1;
            let value = self.gateway(
                "/v4/get_list_all_file",
                params(&[("plat", "1".into())]),
                Some(json!({
                    "listid":listid,"userid":userid,"area_code":1,"show_relate_goods":0,
                    "pagesize":50,"allplatform":1,"show_cover":1,"type":0,"token":token,"page":page
                })),
            )?;
            let data = &value["data"];
            if number(&data["userid"]) != Some(userid)
                || number(&data["listid"]) != Some(listid)
                || number(&data["page"]) != Some(page as u64)
            {
                return Err("酷狗歌单分页或归属发生变化，请刷新后重试".into());
            }
            let total = number(&data["count"])
                .filter(|n| *n <= 100_000)
                .ok_or("酷狗歌单歌曲数量无效")? as usize;
            let version = number(&data["list_ver"]).ok_or("酷狗歌单版本无效")?;
            if *expected.get_or_insert((total, version)) != (total, version) {
                return Err("酷狗歌单已更新，请刷新后重试".into());
            }
            let rows = cloud_rows(data)?;
            if position >= total {
                return Ok(Page {
                    items,
                    total,
                    next_offset: None,
                    filtered: 0,
                });
            }
            let skip = position % 50;
            let span = (limit - (position - offset))
                .min(total - position)
                .min(rows.len().saturating_sub(skip));
            items.extend(rows.iter().skip(skip).take(span).filter_map(cloud_track));
            position += span;
            if position - offset >= limit || position >= total {
                return Ok(Page {
                    filtered: position - offset - items.len(),
                    items,
                    total,
                    next_offset: (position < total).then_some(position),
                });
            }
            if rows.len() < 50 || span == 0 {
                return Err("酷狗返回的歌单分页不完整，请刷新后重试".into());
            }
        }
    }
    fn audio(
        &self,
        track: &Track,
        below: Option<&str>,
        request: AudioRequest,
    ) -> Result<Audio, String> {
        request.check()?;
        if below.is_some() {
            return Err("[decode] 酷狗标准音质无法解码，已停止尝试".into());
        }
        let (hash, _) = locator(track)?;
        if track.numeric_id == 0 || track.media_id.parse::<u64>().is_err() {
            return Err("歌曲播放资料已更新，请重新搜索或刷新歌单".into());
        }
        let (context, _) = self.context(false);
        let key = md5(format!(
            "{hash}57ae12eb6890223e355ccfcb74edf70d1014{}{}",
            context["mid"], context["userid"]
        ));
        let value = self.gateway(
            "/v5/url",
            params(&[
                ("album_id", track.media_id.clone()),
                ("album_audio_id", track.numeric_id.to_string()),
                ("hash", hash.into()),
                ("key", key),
                ("area_code", "1".into()),
                ("ssa_flag", "is_fromtrack".into()),
                ("version", "11430".into()),
                ("quality", "128".into()),
                ("behavior", "play".into()),
                ("pid", "2".into()),
                ("cmd", "26".into()),
                ("pidversion", "3001".into()),
                ("IsFreePart", "0".into()),
                ("cdnBackup", "1".into()),
                ("module", "".into()),
            ]),
            None,
        )?;
        let source = super::kugou_audio::source(&value, track, hash)?;
        super::kugou_audio::download(
            source,
            track,
            &self.prepared,
            self.cache.clone(),
            self.scope(),
            &request,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_web_signature_and_rsa_match_independent_fixture() {
        let query = params(&[
            ("appid", "1014".into()),
            ("clienttime", "1700000000000".into()),
            ("keyword", "许嵩 & test".into()),
        ]);
        assert_eq!(
            signature(&query, WEB_SALT),
            "eb88bc6ab77add9686c0e3e1063b9d96"
        );
        assert_eq!(rsa_key(1700000000000,"0123456789ABCDEF").unwrap(), "2761cfeadd52a858604ba3ee94fac965183d3911a562c612bb8af2b4f2524e1dbfe269b385b095be18989e836016e5513eff8f28646ed6958dd7c976db1db784140526095e1b71ec291217fd912c48e3b2d1b498925c51353ee1274f86e76432119052a4aa4d15f57a041d902b1cd83d6dce9a29f1a43f7b51ec1ac608b94f5d");
        assert_eq!(encrypted_token("synthetic-test-token","0123456789ABCDEF").unwrap(),"25eba8fc8e95ece1501c4eee8ca3eb310abfb9243cd8785834a622042165cebcdea45b88acf5b302acf3dc47f0d84cb9");
    }
    #[test]
    fn official_asset_boundaries() {
        for url in [
            "https://imge.kugou.com.evil.test/a",
            "http://127.0.0.1/a",
            "https://user@imge.kugou.com/a",
            "https://imge.kugou.com:9443/a",
        ] {
            assert!(asset(url).is_none());
        }
        assert_eq!(
            asset("http://imge.kugou.com/a/{size}.jpg")
                .unwrap()
                .as_str(),
            "https://imge.kugou.com/a/240.jpg"
        );
    }
    #[test]
    fn cookies_keep_origin_path_expiry_and_identity() {
        let records = vec![
            "KuGoo=KugooID%3D123%26t%3Dtest; Domain=.kugou.com; Path=/; Secure".into(),
            "t=test; Domain=.kugou.com; Path=/; Secure".into(),
            "t=expired; Domain=.kugou.com; Path=/; Max-Age=0".into(),
            "t=foreign; Domain=evil.test; Path=/".into(),
        ];
        let fields = website_cookies(&jar(&records));
        assert_eq!(cookie_identity(&fields), Some(123));
        assert!(!fields.contains_key("t"));
        let other = jar(&["KuGoo=KugooID%3D321; Domain=.kugou.com; Path=/private; Secure".into()]);
        assert_eq!(cookie_identity(&website_cookies(&other)), None);
    }

    #[test]
    fn restored_session_requires_remote_validation_and_library_is_read_only() {
        let session = Session {
            token: "synthetic".into(),
            userid: 123,
            mid: "0123456789abcdef0123456789abcdef".into(),
            cookies: vec!["KuGoo=KugooID%3D123; Domain=.kugou.com; Path=/; Secure".into()],
            nickname: "示例".into(),
            avatar: None,
            freshly_validated: true,
        };
        let restored: Session =
            serde_json::from_slice(&serde_json::to_vec(&session).unwrap()).unwrap();
        assert!(!restored.freshly_validated);
        let provider = Kugou::new(&restored).unwrap();
        for capability in ["favorite-write", "playlist-write"] {
            assert!(!provider.supports(capability));
        }
        assert!(provider.supports("playback"));
        assert!(provider.supports("playlists"));
    }

    #[test]
    fn jsonp_is_data_and_song_identity_uses_the_official_encoded_version() {
        assert!(jsonp(br#"callback123({"status":1,"data":{}});"#).is_ok());
        for bytes in [
            b"other({});".as_slice(),
            b"callback123({});alert(1)",
            b"callback123(eval('x'))",
        ] {
            assert!(jsonp(bytes).is_err());
        }
        let track=web_track(&json!({"FileHash":"ABCDEF0123456789ABCDEF0123456789","EMixSongID":"nshns3d","MixSongID":123,"SongName":"<em>示例</em>&amp;Live","Duration":264})).unwrap();
        assert_eq!(track.title, "示例&Live");
        assert_eq!(
            locator(&track).unwrap(),
            ("abcdef0123456789abcdef0123456789", "nshns3d")
        );
        assert_eq!(track.duration, 264.0);
        assert!(web_track(&json!({"FileHash":"ABCDEF0123456789ABCDEF0123456789","MixSongID":123,"SongName":"示例"})).is_none());
    }

    #[test]
    fn cloud_track_retains_version_and_album_for_native_playback_without_exposing_metadata() {
        let track = cloud_track(
            &json!({"hash":"ABCDEF0123456789ABCDEF0123456789","mixsongid":456,
            "name":"示例歌手 - 示例 (Live)","singerinfo":[{"name":"示例歌手"}],"timelen":259000,
            "album_id":"789","albuminfo":{"name":"专辑"},"media_pay_type":1}),
        )
        .unwrap();
        assert_eq!(track.title, "示例 (Live)");
        assert_eq!(track.numeric_id, 456);
        assert_eq!(track.media_id, "789");
        assert_eq!(track.duration, 259.0);
        assert_eq!(locator(&track).unwrap().1, "n456");
        let wire = serde_json::to_value(&track).unwrap();
        assert!(wire.get("mediaId").is_none());
        assert!(wire.get("numericId").is_none());
        assert!(cloud_track(&json!({"hash":"../a","mixsongid":456})).is_none());
        assert!(cloud_rows(&json!({"count":0,"info":null}))
            .unwrap()
            .is_empty());
        assert!(cloud_rows(&json!({"count":1,"info":null})).is_err());
    }

    #[test]
    #[ignore = "Explicit live library and complete-audio validation; account credentials supplied only through stdin"]
    fn live_library_and_full_playback_from_stdin() {
        use std::sync::atomic::AtomicBool;
        use symphonia::core::{
            codecs::DecoderOptions, formats::FormatOptions, io::MediaSourceStream,
            meta::MetadataOptions, probe::Hint,
        };
        let mut bytes = Vec::new();
        std::io::stdin()
            .take(1024 * 1024)
            .read_to_end(&mut bytes)
            .expect("bounded stdin");
        let mut session: Session = serde_json::from_slice(&bytes).expect("session structure");
        bytes.fill(0);
        session.validate().expect("remote account validation");
        let provider = Kugou::new(&session).expect("provider");
        let created = provider
            .playlists("created", 0, 100)
            .expect("real created playlists");
        let collected = provider
            .playlists("collected", 0, 100)
            .expect("real collected playlists");
        for list in created.items.iter().chain(&collected.items) {
            let songs = provider
                .tracks(&list.id, 0, 100)
                .expect("real private playlist tracks");
            if let Some(track) = songs.items.first() {
                assert!(!provider
                    .lyrics(track)
                    .expect("numeric-version lyrics")
                    .is_empty());
            }
        }
        let page = provider
            .search("Turbotronic 123", 0, 1)
            .expect("real song search");
        let track = page.items.first().expect("sample track");
        let cancelled = Arc::new(AtomicBool::new(false));
        let audio = provider
            .audio(
                track,
                None,
                AudioRequest {
                    prefetch: false,
                    cancelled: cancelled.clone(),
                    buffering: Box::new(|| {}),
                },
            )
            .expect("full authorized source");
        assert_eq!(audio.quality.id, "standard");
        let stream = audio.stream.as_ref().expect("native progressive stream");
        let mut response = network(None)
            .unwrap()
            .get(stream.url())
            .send()
            .expect("local player transport");
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let mut complete = Vec::new();
        response
            .read_to_end(&mut complete)
            .expect("complete local audio transport");
        assert_eq!(complete.len(), stream.progress().total);
        let probed = symphonia::default::get_probe()
            .format(
                &Hint::new(),
                MediaSourceStream::new(
                    Box::new(std::io::Cursor::new(complete)),
                    Default::default(),
                ),
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .expect("real MP3 probe");
        let mut format = probed.format;
        let decoder_track = format.default_track().expect("real MP3 track");
        let decoder_id = decoder_track.id;
        let mut decoder = symphonia::default::get_codecs()
            .make(&decoder_track.codec_params, &DecoderOptions::default())
            .expect("real MP3 decoder");
        let mut seconds = 0.0;
        loop {
            match format.next_packet() {
                Ok(packet) if packet.track_id() == decoder_id => {
                    let decoded = decoder.decode(&packet).expect("complete MP3 decode");
                    seconds += decoded.frames() as f64 / decoded.spec().rate as f64;
                }
                Ok(_) => {}
                Err(symphonia::core::errors::Error::IoError(e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    break
                }
                Err(_) => panic!("complete MP3 packet stream failed"),
            }
        }
        assert!(
            (seconds - track.duration).abs() < 2.0,
            "decoded full duration"
        );
        cancelled.store(true, std::sync::atomic::Ordering::Release);
        println!("Private playlist reads, numeric-version lyrics, full authorized MP3, progressive loopback transport and complete decoding passed");
    }

    #[test]
    #[ignore = "Explicit live website validation; scoped credentials supplied through stdin, never stored"]
    fn live_official_web_session_from_stdin() {
        let mut bytes = Vec::new();
        std::io::stdin()
            .take(1024 * 1024)
            .read_to_end(&mut bytes)
            .expect("bounded stdin");
        let mut session: Session = serde_json::from_slice(&bytes).expect("session structure");
        bytes.fill(0);
        // Exercise restoration using the exchanged website token, rather than
        // trusting a saved nickname or the original QR confirmation token.
        session
            .validate()
            .expect("official website account revalidation");
        let provider = Kugou::new(&session).expect("website credential scope");
        assert_eq!(provider.account().expect("account").provider, "kugou");
        let first = provider
            .search("许嵩", 0, 3)
            .expect("web search first page");
        let second = provider
            .search("许嵩", 30, 3)
            .expect("web search second page");
        assert_eq!(first.items.len(), 3);
        assert_eq!(second.items.len(), 3);
        assert!(first
            .items
            .iter()
            .all(|a| second.items.iter().all(|b| a.id != b.id)));
        let crossing = provider
            .search("许嵩", 27, 5)
            .expect("web search arbitrary offset");
        assert_eq!(crossing.items.len(), 5);
        assert_eq!(crossing.next_offset, Some(32));
        assert!(crossing.items[3].id == second.items[0].id);
        assert!(provider
            .artwork(first.items[0].cover.as_deref().expect("official cover URL"))
            .is_some());
        let lyrics = provider
            .lyrics(&first.items[0])
            .expect("official website LRC");
        assert!(!crate::lyrics::parse(&lyrics)
            .expect("shared LRC parser")
            .is_empty());
    }

    #[test]
    #[ignore = "Explicit live official-web QR creation; no account or QR output"]
    fn live_official_web_qr_creation() {
        let qr = QrLogin::create().expect("official website QR creation");
        assert!(qr.image.starts_with("data:image/png;base64,"));
    }
}
