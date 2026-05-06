use serde::{Deserialize, Serialize};

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
