use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

// ── Shared output type ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct LinkPreview {
    pub url: String,
    pub title: String,
    pub description: String,
    pub thumbnail_url: String,
    pub domain: String,
    #[serde(rename = "type")]
    pub link_type: String,
}

// ── Internal oEmbed shape ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct OEmbedResponse {
    title: String,
    author_name: Option<String>,
    thumbnail_url: Option<String>,
}

// ── URL detection ─────────────────────────────────────────────────────────────

fn detect_link_type(url: &str) -> &'static str {
    let lower = url.to_lowercase();
    if lower.contains("youtube.com/") || lower.contains("youtu.be/") {
        "youtube"
    } else if lower.contains("instagram.com/p/")
        || lower.contains("instagram.com/reel/")
        || lower.contains("instagram.com/tv/")
    {
        "instagram"
    } else if lower.contains("twitter.com/") || lower.contains("x.com/") {
        "twitter"
    } else {
        "generic"
    }
}

fn extract_domain(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
        .trim_start_matches("www.")
        .to_string()
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Extract the value of `attr="..."` or `attr='...'` from a single tag string.
fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    for quote in ['"', '\''] {
        let needle = format!("{}={}", attr, quote);
        if let Some(pos) = lower.find(&needle) {
            let start = pos + needle.len();
            let end = tag[start..].find(quote)?;
            return Some(html_decode(&tag[start..start + end]));
        }
    }
    None
}

/// Find a `<meta>` tag containing `needle` in its attributes and return its `content` value.
/// Only searches within the first `limit` bytes for performance.
fn find_meta(html: &str, needle: &str, limit: usize) -> Option<String> {
    let head = &html[..html.len().min(limit)];
    let head_lower = head.to_lowercase();
    let pos = head_lower.find(needle)?;
    let tag_start = head[..pos].rfind('<')?;
    let tag_end = head[pos..].find('>')?;
    let tag = &head[tag_start..pos + tag_end + 1];
    extract_attr(tag, "content")
}

fn find_og(html: &str, prop: &str) -> Option<String> {
    find_meta(html, &format!("og:{}", prop), 50_000)
}

fn find_twitter_image(html: &str) -> Option<String> {
    find_meta(html, "twitter:image", 50_000)
}

/// Grab the `src` of the first `<img>` tag with a non-empty src.
fn find_first_img(html: &str) -> Option<String> {
    let limit = html.len().min(200_000);
    let search = &html[..limit];
    let lower = search.to_lowercase();
    let mut pos = 0;
    while let Some(tag_start) = lower[pos..].find("<img") {
        let abs_start = pos + tag_start;
        let tag_end = lower[abs_start..].find('>').unwrap_or(0);
        let tag = &search[abs_start..abs_start + tag_end + 1];
        if let Some(src) = extract_attr(tag, "src") {
            if !src.is_empty() && !src.starts_with("data:") {
                return Some(src);
            }
        }
        pos = abs_start + 1;
    }
    None
}

fn find_title_tag(html: &str) -> Option<String> {
    let limit = html.len().min(50_000);
    let head = &html[..limit];
    let lower = head.to_lowercase();
    let start = lower.find("<title>")? + 7;
    let end = lower[start..].find("</title>")?;
    Some(html_decode(head[start..start + end].trim()))
}

// ── Fetch strategies ──────────────────────────────────────────────────────────

async fn fetch_youtube(client: &reqwest::Client, url: &str) -> Result<LinkPreview, String> {
    let oembed_url = format!(
        "https://www.youtube.com/oembed?url={}&format=json",
        url
    );
    let resp = client
        .get(&oembed_url)
        .send()
        .await
        .map_err(|e| format!("oEmbed request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("oEmbed status {}", resp.status()));
    }

    let data: OEmbedResponse = resp
        .json()
        .await
        .map_err(|e| format!("oEmbed parse failed: {}", e))?;

    Ok(LinkPreview {
        url: url.to_string(),
        title: data.title,
        description: data.author_name.unwrap_or_default(),
        thumbnail_url: data.thumbnail_url.unwrap_or_default(),
        domain: "youtube.com".to_string(),
        link_type: "youtube".to_string(),
    })
}

async fn fetch_generic(client: &reqwest::Client, url: &str) -> Result<LinkPreview, String> {
    let resp = client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("fetch failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let html = resp.text().await.map_err(|e| e.to_string())?;
    let domain = extract_domain(url);

    let title = find_og(&html, "title")
        .or_else(|| find_title_tag(&html))
        .unwrap_or_else(|| domain.clone());

    let description = find_og(&html, "description").unwrap_or_default();

    // Fallback chain: og:image → twitter:image → first <img> → Google favicon
    let thumbnail_url = find_og(&html, "image")
        .or_else(|| find_twitter_image(&html))
        .or_else(|| find_first_img(&html))
        .unwrap_or_else(|| {
            format!("https://www.google.com/s2/favicons?domain={}&sz=128", domain)
        });

    Ok(LinkPreview {
        url: url.to_string(),
        title,
        description,
        thumbnail_url,
        domain,
        link_type: "generic".to_string(),
    })
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Unified command: auto-detects URL type and fetches preview metadata.
/// Returns title, description, thumbnail_url, domain, and type.
#[tauri::command]
pub async fn cmd_fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    match detect_link_type(&url) {
        "youtube" => fetch_youtube(&client, &url).await,
        _ => fetch_generic(&client, &url).await,
    }
}

// ── Instagram via Apify ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ApifyPost {
    #[serde(rename = "displayUrl", default)]
    display_url: String,
    #[serde(rename = "thumbnailUrl", default)]
    thumbnail_url: String,
    #[serde(rename = "videoUrl", default)]
    video_url: String,
    #[serde(rename = "ownerUsername", default)]
    owner_username: String,
    #[serde(rename = "ownerFullName", default)]
    owner_full_name: String,
    #[serde(default)]
    caption: Option<String>,
}

/// Fetches an Instagram reel/post thumbnail via Apify.
/// Reads the API key from brainboard-config.json — never hardcoded.
/// Returns "no_apify_key" error when no key is configured so the caller
/// can silently fall back to the favicon without showing an error.
#[tauri::command]
pub async fn cmd_fetch_instagram_preview(
    url: String,
    app_handle: tauri::AppHandle,
) -> Result<LinkPreview, String> {
    let store = app_handle
        .store("brainboard-config.json")
        .map_err(|e| format!("store: {}", e))?;

    let api_key = store
        .get("apifyKey")
        .and_then(|v| v.as_str().map(String::from))
        .ok_or_else(|| "no_apify_key".to_string())?;

    log::info!("[IG] apify key found (len={}), scraping: {}", api_key.len(), url);

    let apify_url = format!(
        "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items\
         ?token={}&timeout=30",
        api_key
    );

    let body = serde_json::json!({
        "directUrls": [url],
        "resultsType": "posts",
        "resultsLimit": 1
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(35))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&apify_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("apify request failed: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.map_err(|e| format!("apify read body: {}", e))?;
    log::info!("[IG] apify status: {}", status);
    log::info!("[IG] apify body: {}", &body_text[..body_text.len().min(2000)]);

    if !status.is_success() {
        return Err(format!("apify status {}: {}", status, &body_text[..body_text.len().min(200)]));
    }

    let posts: Vec<ApifyPost> = serde_json::from_str(&body_text)
        .map_err(|e| format!("apify parse failed: {} — body: {}", e, &body_text[..body_text.len().min(200)]))?;

    log::info!("[IG] apify returned {} posts", posts.len());

    let post = posts
        .into_iter()
        .next()
        .ok_or_else(|| "apify: no results".to_string())?;

    log::info!("[IG] parsed post: displayUrl={:?} thumbnailUrl={:?} videoUrl={:?} owner={:?} fullName={:?}",
        post.display_url, post.thumbnail_url, post.video_url, post.owner_username, post.owner_full_name);

    let description = post
        .caption
        .as_deref()
        .unwrap_or("")
        .chars()
        .take(100)
        .collect::<String>();

    // Instagram CDN blocks hotlinking from browser origins, so download the image
    // in Rust (no origin restriction) and return a base64 data URL instead.
    let thumbnail_data_url = if !post.display_url.is_empty() {
        let img_resp = client
            .get(&post.display_url)
            .header("Referer", "https://www.instagram.com/")
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .send()
            .await;
        match img_resp {
            Ok(r) if r.status().is_success() => {
                let content_type = r.headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("image/jpeg")
                    .split(';').next().unwrap_or("image/jpeg")
                    .to_string();
                match r.bytes().await {
                    Ok(bytes) => {
                        use base64::{Engine as _, engine::general_purpose::STANDARD};
                        let b64 = STANDARD.encode(&bytes);
                        log::info!("[IG] image downloaded: {} bytes, type={}", bytes.len(), content_type);
                        format!("data:{};base64,{}", content_type, b64)
                    }
                    Err(e) => { log::warn!("[IG] image read failed: {}", e); String::new() }
                }
            }
            Ok(r) => { log::warn!("[IG] image fetch status: {}", r.status()); String::new() }
            Err(e) => { log::warn!("[IG] image fetch failed: {}", e); String::new() }
        }
    } else {
        String::new()
    };

    Ok(LinkPreview {
        url,
        title: post.owner_username,
        description,
        thumbnail_url: thumbnail_data_url,
        domain: "instagram.com".to_string(),
        link_type: "instagram".to_string(),
    })
}

/// Kept for backward compatibility — test button in TopBar uses this.
#[derive(Debug, Serialize)]
pub struct YouTubePreview {
    pub title: String,
    pub author_name: String,
    pub thumbnail_url: String,
    #[serde(rename = "type")]
    pub link_type: String,
}

#[tauri::command]
pub async fn cmd_fetch_youtube_preview(url: String) -> Result<YouTubePreview, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let oembed_url = format!(
        "https://www.youtube.com/oembed?url={}&format=json",
        url
    );
    let resp = client
        .get(&oembed_url)
        .send()
        .await
        .map_err(|e| format!("oEmbed request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("oEmbed returned status {}", resp.status()));
    }

    let data: OEmbedResponse = resp
        .json()
        .await
        .map_err(|e| format!("oEmbed parse failed: {}", e))?;

    Ok(YouTubePreview {
        title: data.title,
        author_name: data.author_name.unwrap_or_default(),
        thumbnail_url: data.thumbnail_url.unwrap_or_default(),
        link_type: "youtube".to_string(),
    })
}
