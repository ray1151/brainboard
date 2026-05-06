use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
struct OEmbedResponse {
    title: String,
    author_name: Option<String>,
    thumbnail_url: Option<String>,
}

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
    let oembed_url = format!(
        "https://www.youtube.com/oembed?url={}&format=json",
        url
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

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
