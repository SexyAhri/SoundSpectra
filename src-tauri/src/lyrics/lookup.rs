use super::LyricDocument;
use std::{
    future::{poll_fn, Future},
    pin::pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    task::Poll,
};
use tokio::sync::Notify;

#[derive(Default)]
pub struct Cancellation {
    cancelled: AtomicBool,
    wake: Notify,
}
impl Cancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.wake.notify_one();
    }
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }
    async fn cancelled(&self) {
        loop {
            if self.is_cancelled() {
                return;
            }
            self.wake.notified().await;
        }
    }
}
pub struct LocalStop {
    stopped: AtomicBool,
    parent: Arc<Cancellation>,
}
impl LocalStop {
    pub fn new(parent: Arc<Cancellation>) -> Self {
        Self {
            stopped: AtomicBool::new(false),
            parent,
        }
    }
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire) || self.parent.is_cancelled()
    }
}
pub struct StopLocalOnDrop(pub Arc<LocalStop>);
impl Drop for StopLocalOnDrop {
    fn drop(&mut self) {
        self.0.stopped.store(true, Ordering::Release);
    }
}

/// Only valid, nonempty lyrics can win. Dropping the losing async HTTP future
/// cancels its request/body read; a miss never cancels the other source.
pub async fn first_valid<A, B>(
    local: A,
    online: B,
    cancel: Arc<Cancellation>,
) -> Option<LyricDocument>
where
    A: Future<Output = Option<LyricDocument>>,
    B: Future<Output = Option<LyricDocument>>,
{
    let mut local = pin!(local);
    let mut online = pin!(online);
    let mut cancelled = pin!(cancel.cancelled());
    let (mut local_done, mut online_done) = (false, false);
    let mut failure: Option<LyricDocument> = None;
    poll_fn(|cx| {
        if cancelled.as_mut().poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        if !local_done {
            if let Poll::Ready(found) = local.as_mut().poll(cx) {
                local_done = true;
                if let Some(found) = found {
                    if valid(&found) {
                        return Poll::Ready(Some(found));
                    }
                    remember_failure(&mut failure, found);
                }
            }
        }
        if !online_done {
            if let Poll::Ready(found) = online.as_mut().poll(cx) {
                online_done = true;
                if let Some(found) = found {
                    if valid(&found) {
                        return Poll::Ready(Some(found));
                    }
                    remember_failure(&mut failure, found);
                }
            }
        }
        if local_done && online_done {
            Poll::Ready(failure.take())
        } else {
            Poll::Pending
        }
    })
    .await
}
fn remember_failure(failure: &mut Option<LyricDocument>, found: LyricDocument) {
    if !matches!(found.status.as_str(), "error" | "ambiguous") {
        return;
    }
    if failure.is_none() {
        *failure = Some(found);
    } else if let Some(previous) = failure.as_mut() {
        if !previous.message.contains(&found.message) {
            previous.message.push_str("；");
            previous.message.push_str(&found.message);
        }
        if found.status == "error" {
            previous.status = found.status;
        }
    }
}
fn valid(document: &LyricDocument) -> bool {
    document.status == "ready" && !document.lines.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{future::pending, time::Duration};
    struct Dropped(Arc<AtomicBool>);
    impl Drop for Dropped {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    fn found(key: &str) -> LyricDocument {
        LyricDocument {
            key: key.into(),
            status: "ready".into(),
            lines: vec![super::super::Line {
                text: "原创测试".into(),
                start: 0,
                end: 1000,
                words: Vec::new(),
            }],
            ..Default::default()
        }
    }
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    #[test]
    fn reports_source_failures_only_after_other_sources_finish() {
        runtime().block_on(async {
            let failed = || async {
                Some(LyricDocument {
                    status: "error".into(),
                    message: "AMLL 请求较多，请稍后重试".into(),
                    ..Default::default()
                })
            };
            let result = first_valid(failed(), async { None }, Arc::default())
                .await
                .unwrap();
            assert_eq!(result.status, "error");
            assert!(result.message.contains("请求较多"));
            let good = async {
                tokio::time::sleep(Duration::from_millis(10)).await;
                Some(found("fallback"))
            };
            assert_eq!(
                first_valid(failed(), good, Arc::default())
                    .await
                    .unwrap()
                    .key,
                "fallback"
            );
        });
    }
    #[test]
    fn either_source_can_win_and_the_losing_future_is_dropped() {
        runtime().block_on(async {
            for remote_wins in [false, true] {
                let dropped = Arc::new(AtomicBool::new(false));
                let flag = dropped.clone();
                let slow = async move {
                    let _guard = Dropped(flag);
                    pending::<Option<LyricDocument>>().await
                };
                let fast = async {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    Some(found("winner"))
                };
                let result = if remote_wins {
                    first_valid(slow, fast, Arc::default()).await
                } else {
                    first_valid(fast, slow, Arc::default()).await
                };
                assert_eq!(result.unwrap().key, "winner");
                assert!(dropped.load(Ordering::SeqCst));
            }
        });
    }
    #[test]
    fn an_empty_or_invalid_response_does_not_win_or_cancel_a_good_source() {
        runtime().block_on(async {
            let miss = async {
                Some(LyricDocument {
                    status: "ready".into(),
                    ..Default::default()
                })
            };
            let good = async {
                tokio::time::sleep(Duration::from_millis(10)).await;
                Some(found("good"))
            };
            assert_eq!(
                first_valid(miss, good, Arc::default()).await.unwrap().key,
                "good"
            );
            assert!(first_valid(async { None }, async { None }, Arc::default())
                .await
                .is_none());
        });
    }
    #[test]
    fn changing_tracks_cancels_both_pending_sources() {
        runtime().block_on(async {
            let cancel = Arc::new(Cancellation::default());
            let signal = cancel.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(10)).await;
                signal.cancel();
            });
            assert!(first_valid(pending(), pending(), cancel).await.is_none());
        });
    }
}
