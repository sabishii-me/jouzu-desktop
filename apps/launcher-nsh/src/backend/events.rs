//! The event bus that replaces `tauri::Emitter::emit`. Backend worker threads
//! publish named JSON events; the TSX host pumps them with `Events.wait()`,
//! which resolves as soon as anything is published (no polling).

use serde_json::Value;
use std::sync::Mutex;

static QUEUE: Mutex<Vec<Value>> = Mutex::new(Vec::new());
static NOTIFY: tokio::sync::Notify = tokio::sync::Notify::const_new();

/// Publish an event from any thread. The payload keeps the baseline shape:
/// `{ "event": name, "payload": value }`.
pub fn publish(event: &str, payload: Value) {
    if let Ok(mut queue) = QUEUE.lock() {
        queue.push(serde_json::json!({ "event": event, "payload": payload }));
    }
    NOTIFY.notify_one();
}

/// Wait until at least one event is queued, then take everything queued.
pub async fn wait() -> Vec<Value> {
    loop {
        {
            let mut queue = QUEUE.lock().expect("event queue poisoned");
            if !queue.is_empty() {
                return std::mem::take(&mut *queue);
            }
        }
        NOTIFY.notified().await;
    }
}