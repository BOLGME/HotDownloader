//! 使用本地合成音频验证实际 HTTP 鉴权、Range、HEAD 和会话释放。

use super::*;
use hotdownloader_core::playback::PlaybackSource;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

async fn read_headers(socket: &mut TcpStream) -> String {
    let mut data = Vec::new();
    while !data.windows(4).any(|part| part == b"\r\n\r\n") {
        let mut byte = [0];
        assert_eq!(socket.read(&mut byte).await.unwrap(), 1);
        data.push(byte[0]);
        assert!(data.len() < 16 * 1024);
    }
    String::from_utf8(data).unwrap()
}

async fn request(address: std::net::SocketAddr, method: &str, path: &str, headers: &str) -> String {
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut socket = TcpStream::connect(address).await.unwrap();
        socket.write_all(format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{headers}\r\n").as_bytes()).await.unwrap();
        let mut data = Vec::new();
        socket.read_to_end(&mut data).await.unwrap();
        String::from_utf8(data).unwrap()
    }).await.unwrap()
}

#[tokio::test]
async fn playback_range_head_authentication_and_release() {
    let directory = std::env::temp_dir().join(format!(
        "hotdownloader-playback-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    let monitors = crate::monitor::MonitorService::open(&directory).unwrap();
    let mut runtime = ServerRuntime::test_runtime(&directory, monitors);
    Arc::get_mut(&mut runtime).unwrap().auth = crate::auth::AccessAuth::Token("test-access".into());

    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let source = PlaybackSource {
        id: "a".repeat(64),
        url: format!("http://{}/audio", upstream.local_addr().unwrap()),
        quality: "128kmp3".into(),
        content_type: "audio/mpeg".into(),
    };
    let public = runtime.playback.insert(source).unwrap();
    let producer = tokio::spawn(async move {
        let (mut socket, _) = upstream.accept().await.unwrap();
        let headers = read_headers(&mut socket).await.to_lowercase();
        assert!(headers.starts_with("get /audio "));
        assert!(headers.contains("range: bytes=4-8\r\n"));
        assert!(!headers.contains("authorization:"));
        socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 4-8/10\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n45678").await.unwrap();
        drop(socket);
        let (mut socket, _) = upstream.accept().await.unwrap();
        assert!(read_headers(&mut socket).await.starts_with("HEAD /audio "));
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n").await.unwrap();
    });
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let service_runtime = runtime.clone();
    let server = tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let runtime = service_runtime.clone();
            tokio::spawn(async move {
                http1::Builder::new()
                    .serve_connection(
                        TokioIo::new(socket),
                        service_fn(move |request| handle(request, runtime.clone())),
                    )
                    .await
                    .unwrap();
            });
        }
    });

    assert!(
        request(address, "POST", "/api/playback", "Content-Length: 0\r\n")
            .await
            .starts_with("HTTP/1.1 401")
    );
    assert!(request(address, "GET", "/api/playback/unknown", "")
        .await
        .starts_with("HTTP/1.1 404"));
    let response = request(address, "GET", &public.url, "Range: bytes=4-8\r\n").await;
    assert!(response.starts_with("HTTP/1.1 206"));
    assert!(response.contains("content-range: bytes 4-8/10\r\n"));
    assert!(response.contains("content-type: audio/mpeg\r\n"));
    assert!(response.ends_with("\r\n\r\n45678"));
    let head = request(address, "HEAD", &public.url, "").await;
    assert!(head.starts_with("HTTP/1.1 200"));
    assert!(head.contains("content-length: 10\r\n"));
    assert!(head.ends_with("\r\n\r\n"));
    assert!(request(address, "DELETE", &public.url, "")
        .await
        .starts_with("HTTP/1.1 401"));
    assert!(request(
        address,
        "DELETE",
        &public.url,
        "Authorization: Bearer test-access\r\n"
    )
    .await
    .starts_with("HTTP/1.1 200"));
    assert!(request(address, "GET", &public.url, "")
        .await
        .starts_with("HTTP/1.1 404"));
    assert!(runtime.tasks.list().is_empty());
    producer.await.unwrap();
    server.abort();
    let _ = server.await;
    drop(runtime);
    std::fs::remove_dir_all(directory).unwrap();
}
