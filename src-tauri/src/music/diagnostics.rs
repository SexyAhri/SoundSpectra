use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub kind: &'static str,
    pub retryable: bool,
    pub login_required: bool,
}
impl Failure {
    pub fn classify(message: &str) -> Self {
        let kind = if ["登录", "会话失效", "凭证"]
            .iter()
            .any(|s| message.contains(s))
        {
            "authentication"
        } else if [
            "网络",
            "超时",
            "传输",
            "请求失败",
            "加载失败",
            "连接",
            "timeout",
        ]
        .iter()
        .any(|s| message.contains(s))
        {
            "network"
        } else if ["解码", "格式"].iter().any(|s| message.contains(s)) {
            "decode"
        } else {
            "unavailable"
        };
        Self {
            kind,
            retryable: kind == "network",
            login_required: kind == "authentication",
        }
    }
}
#[derive(Clone, Serialize)]
pub struct Event {
    at: u64,
    stage: &'static str,
    generation: u64,
    kind: Option<&'static str>,
}
#[derive(Default)]
pub struct Diagnostics(Mutex<VecDeque<Event>>);
impl Diagnostics {
    // Only enums and numeric generations enter the log. Never accept remote messages/URLs.
    pub fn record(&self, stage: &'static str, generation: u64, kind: Option<&'static str>) {
        let mut log = self.0.lock().unwrap();
        if log.len() == 512 {
            log.pop_front();
        }
        log.push_back(Event {
            at: super::now(),
            stage,
            generation,
            kind,
        });
    }
    pub fn export(&self) -> Vec<Event> {
        self.0.lock().unwrap().iter().cloned().collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_and_structured() {
        let d = Diagnostics::default();
        for i in 0..1000 {
            d.record("request", i, Some("network"));
        }
        assert_eq!(d.export().len(), 512);
        assert!(Failure::classify("请重新登录").login_required);
        assert!(Failure::classify("音频传输中断").retryable);
        assert!(!Failure::classify("版权不可用").retryable);
    }
}
