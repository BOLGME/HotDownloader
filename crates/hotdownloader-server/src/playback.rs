//! 认证后创建短期试听地址；音频标签凭随机会话 ID 读取，不在 URL 携带登录凭据。

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use hotdownloader_core::playback::PlaybackSource;

const LIFETIME: Duration = Duration::from_secs(2 * 60 * 60);
const MAX_SESSIONS: usize = 256;

#[derive(Default)]
pub struct PlaybackSessions {
    sources: Mutex<HashMap<String, (Instant, PlaybackSource)>>,
}

impl PlaybackSessions {
    pub fn insert(&self, source: PlaybackSource) -> Result<PlaybackSource, String> {
        let mut sources = self.sources.lock().unwrap();
        sources.retain(|_, (created, _)| created.elapsed() < LIFETIME);
        if sources.len() >= MAX_SESSIONS {
            return Err("试听会话过多，请稍后重试".into());
        }
        let mut public = source.clone();
        public.url = format!("/api/playback/{}", source.id);
        sources.insert(source.id.clone(), (Instant::now(), source));
        Ok(public)
    }

    pub fn get(&self, id: &str) -> Option<PlaybackSource> {
        let mut sources = self.sources.lock().unwrap();
        sources.retain(|_, (created, _)| created.elapsed() < LIFETIME);
        sources.get(id).map(|(_, source)| source.clone())
    }

    pub fn remove(&self, id: &str) {
        self.sources.lock().unwrap().remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_hide_upstream_urls_and_expire_or_release_independently() {
        let sessions = PlaybackSessions::default();
        let source = PlaybackSource {
            id: "a".repeat(64),
            url: "http://cdn.example/audio".into(),
            quality: "320kmp3".into(),
            content_type: "audio/mpeg".into(),
        };
        let public = sessions.insert(source.clone()).unwrap();
        assert_eq!(public.url, format!("/api/playback/{}", source.id));
        assert_eq!(sessions.get(&source.id).unwrap().url, source.url);
        assert!(sessions.get("unknown").is_none());
        sessions.remove(&source.id);
        assert!(sessions.get(&source.id).is_none());
        sessions.insert(source.clone()).unwrap();
        sessions
            .sources
            .lock()
            .unwrap()
            .get_mut(&source.id)
            .unwrap()
            .0 = Instant::now() - LIFETIME;
        assert!(sessions.get(&source.id).is_none());
    }
}
