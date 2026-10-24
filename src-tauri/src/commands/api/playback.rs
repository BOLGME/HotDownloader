use hotdownloader_core::playback::{self, PlaybackRequest, PlaybackSource};
use tauri::AppHandle;

use crate::adapters::tauri_download_host::TauriDownloadLinkProvider;

#[tauri::command]
pub async fn resolve_playback(
    app: AppHandle,
    request: PlaybackRequest,
) -> Result<PlaybackSource, String> {
    let mut source = playback::resolve(&TauriDownloadLinkProvider::new(app), request).await?;
    // WebView 中使用 HTTPS 音频，避免桌面安全来源与 Android 明文请求限制。
    if source.url.starts_with("http://") {
        source.url = source.url.replacen("http://", "https://", 1);
    }
    Ok(source)
}
