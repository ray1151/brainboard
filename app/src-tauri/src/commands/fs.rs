use tauri::{State, Emitter};
use grammers_client::{Client, types::{Media, Peer}};
use grammers_client::InputMessage;
use grammers_tl_types as tl;
use crate::TelegramState;
use crate::models::{FolderMetadata, FileMetadata};
use crate::bandwidth::BandwidthManager;
use crate::commands::utils::{resolve_peer, map_error};

// ── message classification ────────────────────────────────────────────────────

enum MsgKind {
    File { name: String, size: u64, mime: Option<String>, ext: Option<String> },
    Link { url: String, og_title: Option<String>, og_description: Option<String>, og_site_name: Option<String>, has_thumb: bool },
    TextOnly,
    Skip,
}

struct CollectedMsg {
    id: i32,
    date_raw: i32,
    date_str: String,
    text: String,
    entities: Vec<tl::enums::MessageEntity>,
    kind: MsgKind,
    sender: Option<i64>,
}

#[tauri::command]
pub async fn cmd_create_folder(
    name: String,
    state: State<'_, TelegramState>,
) -> Result<FolderMetadata, String> {
    let client_opt = {
        state.client.lock().await.clone()
    };
    
    // --- MOCK ---
    if client_opt.is_none() {
        let mock_id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        log::info!("[MOCK] Created folder '{}' with ID {}", name, mock_id);
        return Ok(FolderMetadata {
            id: mock_id,
            name,
            parent_id: None,
        });
    }
    // -----------
    let client = client_opt.unwrap();
    log::info!("Creating Telegram Channel: {}", name);
    
    let result = client.invoke(&tl::functions::channels::CreateChannel {
        broadcast: true,
        megagroup: false,
        title: format!("{} [TD]", name),
        about: "Telegram Drive Storage Folder\n[telegram-drive-folder]".to_string(),
        geo_point: None,
        address: None,
        for_import: false,
        forum: false,
        ttl_period: None, // Initial creation TTL
    }).await.map_err(map_error)?;
    
    let (chat_id, access_hash) = match result {
        tl::enums::Updates::Updates(u) => {
             let chat = u.chats.first().ok_or("No chat in updates")?;
             match chat {
                 tl::enums::Chat::Channel(c) => (c.id, c.access_hash.unwrap_or(0)),
                 _ => return Err("Created chat is not a channel".to_string()),
             }
        },
        _ => return Err("Unexpected response (not Updates::Updates)".to_string()), 
    };

    // Explicitly Disable TTL
    let _input_channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
         channel_id: chat_id,
         access_hash,
    });

    let _ = client.invoke(&tl::functions::messages::SetHistoryTtl {
        peer: tl::enums::InputPeer::Channel(tl::types::InputPeerChannel { channel_id: chat_id, access_hash }),
        period: 0, 
    }).await;

    Ok(FolderMetadata {
        id: chat_id,
        name,
        parent_id: None,
    })
}

#[tauri::command]
pub async fn cmd_delete_folder(
    folder_id: i64,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = {
        state.client.lock().await.clone()
    };
    
    if client_opt.is_none() {
        log::info!("[MOCK] Deleted folder ID {}", folder_id);
        return Ok(true);
    }
    let client = client_opt.unwrap();
    log::info!("Deleting folder/channel: {}", folder_id);

    let peer = resolve_peer(&client, Some(folder_id), &state.peer_cache).await?;
    
    let input_channel = match peer {
        Peer::Channel(c) => {
             let chan = &c.raw;
             tl::enums::InputChannel::Channel(tl::types::InputChannel {
                 channel_id: chan.id,
                 access_hash: chan.access_hash.ok_or("No access hash for channel")?,
             })
        },
        _ => return Err("Only channels (folders) can be deleted.".to_string()),
    };
    
    client.invoke(&tl::functions::channels::DeleteChannel {
        channel: input_channel,
    }).await.map_err(|e| format!("Failed to delete channel: {}", e))?;
    
    Ok(true)
}


#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    id: String,
    percent: u8,
}

#[tauri::command]
pub async fn cmd_upload_file(
    path: String,
    folder_id: Option<i64>,
    transfer_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, TelegramState>,
    bw_state: State<'_, BandwidthManager>,
) -> Result<String, String> {
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    bw_state.can_transfer(size)?;

    let tid = transfer_id.unwrap_or_default();

    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() {
        log::info!("[MOCK] Uploaded file {} to {:?}", path, folder_id);
        bw_state.add_up(size);
        return Ok("Mock upload successful".to_string());
    }
    let client = client_opt.unwrap();
    
    // Emit start progress
    if !tid.is_empty() {
        let _ = app_handle.emit("upload-progress", ProgressPayload { id: tid.clone(), percent: 0 });
    }

    let path_clone = path.clone();
    let client_clone = client.clone();
    
    let uploaded_file = tauri::async_runtime::spawn(async move {
        client_clone.upload_file(&path_clone).await
    }).await.map_err(|e| format!("Task join error: {}", e))?
      .map_err(map_error)?;
        
    let message = InputMessage::new().text("").file(uploaded_file);

    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    
    client.send_message(&peer, message).await.map_err(map_error)?;
    
    bw_state.add_up(size);

    // Emit completion
    if !tid.is_empty() {
        let _ = app_handle.emit("upload-progress", ProgressPayload { id: tid, percent: 100 });
    }

    Ok("File uploaded successfully".to_string())
}

#[tauri::command]
pub async fn cmd_delete_file(
    message_id: i32,
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
         log::info!("[MOCK] Deleted message {} from folder {:?}", message_id, folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    client.delete_messages(&peer, &[message_id]).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn cmd_download_file(
    message_id: i32,
    save_path: String,
    folder_id: Option<i64>,
    transfer_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, TelegramState>,
    bw_state: State<'_, BandwidthManager>,
) -> Result<String, String> {
    let tid = transfer_id.unwrap_or_default();

    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Downloaded message {} from {:?} to {}", message_id, folder_id, save_path);
        if let Err(e) = std::fs::write(&save_path, b"Mock Content") { return Err(e.to_string()); }
        return Ok("Download successful".to_string());
    }
    let client = client_opt.unwrap();
    
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;

    // Use get_messages_by_id for efficient message lookup (same as server.rs)
    let messages = client.get_messages_by_id(&peer, &[message_id]).await.map_err(|e| e.to_string())?;
    
    let msg = messages.into_iter()
        .flatten()
        .next()
        .ok_or_else(|| "Message not found".to_string())?;

    let media = msg.media()
        .ok_or_else(|| "No media in message".to_string())?;

    let total_size = match &media {
        Media::Document(d) => d.size() as u64,
        Media::Photo(_) => 1024 * 1024,
        _ => 0,
    };
    
    bw_state.can_transfer(total_size)?;

    // Emit start
    if !tid.is_empty() {
        let _ = app_handle.emit("download-progress", ProgressPayload { id: tid.clone(), percent: 0 });
    }

    // Stream download with per-chunk progress
    let mut download_iter = client.iter_download(&media);
    let mut file = std::fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 0;

    while let Some(chunk) = download_iter.next().await.transpose() {
        let bytes = chunk.map_err(|e| format!("Download chunk error: {}", e))?;
        std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
        downloaded += bytes.len() as u64;
        
        if !tid.is_empty() && total_size > 0 {
            let percent = ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u8;
            // Only emit when percent actually changes to avoid event spam
            if percent != last_percent {
                last_percent = percent;
                let _ = app_handle.emit("download-progress", ProgressPayload { id: tid.clone(), percent });
            }
        }
    }

    bw_state.add_down(total_size);

    // Emit completion
    if !tid.is_empty() {
        let _ = app_handle.emit("download-progress", ProgressPayload { id: tid, percent: 100 });
    }

    Ok("Download successful".to_string())
}

#[tauri::command]
pub async fn cmd_move_files(
    message_ids: Vec<i32>,
    source_folder_id: Option<i64>,
    target_folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<bool, String> {
    if source_folder_id == target_folder_id { return Ok(true); }
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        log::info!("[MOCK] Moved msgs {:?} from {:?} to {:?}", message_ids, source_folder_id, target_folder_id);
        return Ok(true); 
    }
    let client = client_opt.unwrap();

    let source_peer = resolve_peer(&client, source_folder_id, &state.peer_cache).await?;
    let target_peer = resolve_peer(&client, target_folder_id, &state.peer_cache).await?;

    match client.forward_messages(&target_peer, &message_ids, &source_peer).await {
        Ok(_) => {},
        Err(e) => return Err(format!("Forward failed: {}", e)),
    }
    
    match client.delete_messages(&source_peer, &message_ids).await {
        Ok(_) => {},
        Err(e) => return Err(format!("Delete original failed: {}", e)),
    }

    Ok(true)
}

/// Iterate all messages in `peer` and return them as `FileMetadata`.
/// Pass `folder_name = Some(name)` for aggregate views — enables composite note keys and source badges.
/// Pass `folder_name = None` for single-folder views — note_id is just the message ID (backward compat).
async fn collect_files_from_peer(
    client: &Client,
    folder_id: Option<i64>,
    peer: &Peer,
    folder_name: Option<&str>,
) -> Result<Vec<FileMetadata>, String> {
    // Pass 1: collect all messages into owned structs
    let mut collected: Vec<CollectedMsg> = Vec::new();
    let mut msgs = client.iter_messages(peer);
    while let Some(msg) = msgs.next().await.map_err(|e| e.to_string())? {
        let id = msg.id();
        let date_raw = match &msg.raw {
            tl::enums::Message::Message(m) => m.date,
            _ => 0,
        };
        let date_str = msg.date().to_string();
        let text = msg.text().to_string();
        let entities = msg.fmt_entities().cloned().unwrap_or_default();

        let kind = match msg.media() {
            Some(Media::Document(d)) => {
                let name = d.name().to_string();
                let size = d.size() as u64;
                let mime = d.mime_type().map(|s| s.to_string());
                let ext = std::path::Path::new(&name).extension()
                    .map(|os| os.to_str().unwrap_or("").to_string());
                MsgKind::File { name, size, mime, ext }
            },
            Some(Media::Photo(_)) => MsgKind::File {
                name: "Photo.jpg".to_string(), size: 0,
                mime: Some("image/jpeg".into()), ext: Some("jpg".into()),
            },
            Some(Media::WebPage(wp)) => {
                if let tl::enums::WebPage::Page(page) = wp.raw.webpage {
                    let has_thumb = page.photo.is_some();
                    MsgKind::Link {
                        url: page.url,
                        og_title: page.title,
                        og_description: page.description,
                        og_site_name: page.site_name,
                        has_thumb,
                    }
                } else {
                    MsgKind::Skip
                }
            },
            Some(_) => MsgKind::Skip,
            None => {
                if let Some(url) = extract_first_url(&text, &entities) {
                    MsgKind::Link { url, og_title: None, og_description: None, og_site_name: None, has_thumb: false }
                } else if !text.trim().is_empty() {
                    MsgKind::TextOnly
                } else {
                    MsgKind::Skip
                }
            },
        };
        let sender = match &msg.raw {
            tl::enums::Message::Message(m) => m.from_id.as_ref().map(|p| match p {
                tl::enums::Peer::User(u) => u.user_id,
                tl::enums::Peer::Chat(c) => c.chat_id,
                tl::enums::Peer::Channel(c) => c.channel_id,
            }),
            _ => None,
        };
        let kind_tag = match &kind {
            MsgKind::File { name, .. } => format!("File({})", name),
            MsgKind::Link { url, .. } => { let s = url.len().min(60); format!("Link({})", &url[..s]) },
            MsgKind::TextOnly => { let p: String = text.chars().take(40).collect(); format!("TextOnly({:?})", p) },
            MsgKind::Skip => "Skip".to_string(),
        };
        log::info!("[5A] collected msg={} date={} sender={:?} kind={}", id, date_raw, sender, kind_tag);
        collected.push(CollectedMsg { id, date_raw, date_str, text, entities, kind, sender });
    }

    // Sort by message ID (monotonic within a single chat)
    collected.sort_by_key(|m| m.id);

    // Pass 2: build output
    let folder_name_owned = folder_name.map(|s| s.to_string());
    let mut files: Vec<FileMetadata> = Vec::new();
    for msg in &collected {
        let note_id = if folder_name.is_some() {
            format!("{}_{}",  folder_id.map_or("saved".to_string(), |f| f.to_string()), msg.id)
        } else {
            msg.id.to_string()
        };
        match &msg.kind {
            MsgKind::File { name, size, mime, ext } => {
                files.push(FileMetadata {
                    id: msg.id as i64, folder_id,
                    name: name.clone(), size: *size,
                    mime_type: mime.clone(), file_ext: ext.clone(),
                    created_at: msg.date_str.clone(), date_raw: msg.date_raw,
                    note_id, folder_name: folder_name_owned.clone(),
                    icon_type: "file".into(),
                    url: None, caption: None, og_title: None, og_description: None,
                    og_site_name: None, has_telegram_thumb: false,
                });
            },
            MsgKind::Link { url, og_title, og_description, og_site_name, has_thumb } => {
                let url = url.clone();
                let display_name = og_title.clone().unwrap_or_else(|| url.clone());
                files.push(FileMetadata {
                    id: msg.id as i64, folder_id,
                    name: display_name, size: 0,
                    mime_type: None, file_ext: None,
                    created_at: msg.date_str.clone(), date_raw: msg.date_raw,
                    note_id, folder_name: folder_name_owned.clone(),
                    icon_type: "link".into(),
                    url: Some(url), caption: None,
                    og_title: og_title.clone(), og_description: og_description.clone(),
                    og_site_name: og_site_name.clone(), has_telegram_thumb: *has_thumb,
                });
            },
            MsgKind::TextOnly => {
                let name: String = msg.text.chars().take(80).collect();
                files.push(FileMetadata {
                    id: msg.id as i64, folder_id,
                    name, size: 0,
                    mime_type: None, file_ext: None,
                    created_at: msg.date_str.clone(), date_raw: msg.date_raw,
                    note_id, folder_name: folder_name_owned.clone(),
                    icon_type: "text".into(),
                    url: None, caption: None, og_title: None, og_description: None,
                    og_site_name: None, has_telegram_thumb: false,
                });
            },
            MsgKind::Skip => {},
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn cmd_get_files(
    folder_id: Option<i64>,
    state: State<'_, TelegramState>,
) -> Result<Vec<FileMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() {
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();
    let peer = resolve_peer(&client, folder_id, &state.peer_cache).await?;
    collect_files_from_peer(&client, folder_id, &peer, None).await
}

#[tauri::command]
pub async fn cmd_get_all_files(
    state: State<'_, TelegramState>,
) -> Result<Vec<FileMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() {
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();

    let mut all_files: Vec<FileMetadata> = Vec::new();

    // Saved Messages (folder_id = None)
    let saved_peer = resolve_peer(&client, None, &state.peer_cache).await?;
    let mut saved = collect_files_from_peer(&client, None, &saved_peer, Some("Saved Messages")).await?;
    all_files.append(&mut saved);

    // Collect [TD] channel peers with display names (cap 20)
    let mut td_peers: Vec<(i64, String, Peer)> = Vec::new();
    {
        let mut dialogs = client.iter_dialogs();
        while let Some(dialog) = dialogs.next().await.map_err(|e| e.to_string())? {
            if let Peer::Channel(c) = &dialog.peer {
                if c.raw.title.to_lowercase().contains("[td]") {
                    let display = c.raw.title
                        .replace(" [TD]", "").replace(" [td]", "")
                        .replace("[TD]", "").replace("[td]", "")
                        .trim().to_string();
                    td_peers.push((c.raw.id, display, dialog.peer.clone()));
                    if td_peers.len() >= 20 { break; }
                }
            }
        }
    }

    for (fid, display_name, peer) in td_peers {
        let mut folder_files = collect_files_from_peer(&client, Some(fid), &peer, Some(&display_name)).await?;
        all_files.append(&mut folder_files);
    }

    // Sort newest first using Unix timestamp
    all_files.sort_by(|a, b| b.date_raw.cmp(&a.date_raw));

    Ok(all_files)
}

/// Returns the first HTTP/HTTPS URL found via entity offsets, with bare-text fallback.
fn extract_first_url(text: &str, entities: &[tl::enums::MessageEntity]) -> Option<String> {
    for entity in entities {
        match entity {
            tl::enums::MessageEntity::Url(e) => {
                let chars: Vec<char> = text.chars().collect();
                let offset = e.offset as usize;
                let length = e.length as usize;
                if offset + length <= chars.len() {
                    let url: String = chars[offset..offset + length].iter().collect();
                    if url.starts_with("http://") || url.starts_with("https://") {
                        return Some(url);
                    }
                }
            },
            tl::enums::MessageEntity::TextUrl(e) => {
                if e.url.starts_with("http://") || e.url.starts_with("https://") {
                    return Some(e.url.clone());
                }
            },
            _ => {},
        }
    }
    if let Some(pos) = text.find("https://") {
        let end = text[pos..].find(char::is_whitespace).map(|e| pos + e).unwrap_or(text.len());
        return Some(text[pos..end].to_string());
    }
    if let Some(pos) = text.find("http://") {
        let end = text[pos..].find(char::is_whitespace).map(|e| pos + e).unwrap_or(text.len());
        return Some(text[pos..end].to_string());
    }
    None
}


#[tauri::command]
pub async fn cmd_search_global(
    query: String,
    state: State<'_, TelegramState>,
) -> Result<Vec<FileMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();
    let mut files = Vec::new();
    
    log::info!("Searching global for: {}", query);

    let result = client.invoke(&tl::functions::messages::SearchGlobal {
        q: query,
        filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
        min_date: 0,
        max_date: 0,
        offset_rate: 0,
        offset_peer: tl::enums::InputPeer::Empty,
        offset_id: 0,
        limit: 50,
        folder_id: None,
        broadcasts_only: false,
        groups_only: false,
        users_only: false,
    }).await.map_err(map_error)?;

    if let tl::enums::messages::Messages::Messages(msgs) = result {
        for msg in msgs.messages {
            if let tl::enums::Message::Message(m) = msg {
                if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                    if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                        let name = doc.attributes.iter().find_map(|a| match a {
                            tl::enums::DocumentAttribute::Filename(f) => Some(f.file_name.clone()),
                            _ => None
                        }).unwrap_or("Unknown".to_string());
                        let size = doc.size as u64;
                        let mime = doc.mime_type.clone();
                        let ext = std::path::Path::new(&name).extension().map(|os| os.to_str().unwrap_or("").to_string());
                        let folder_id = match m.peer_id {
                            tl::enums::Peer::Channel(c) => Some(c.channel_id),
                            tl::enums::Peer::User(u) => Some(u.user_id),
                            tl::enums::Peer::Chat(c) => Some(c.chat_id),
                        };
                        files.push(FileMetadata {
                            id: m.id as i64, folder_id, name, size,
                            mime_type: Some(mime), file_ext: ext,
                            created_at: m.date.to_string(), date_raw: m.date,
                            note_id: m.id.to_string(), folder_name: None,
                            icon_type: "file".into(),
                            url: None, caption: None, og_title: None, og_description: None,
                            og_site_name: None, has_telegram_thumb: false,
                        });
                    }
                }
            }
        }
    } else if let tl::enums::messages::Messages::Slice(msgs) = result {
        for msg in msgs.messages {
            if let tl::enums::Message::Message(m) = msg {
                if let Some(tl::enums::MessageMedia::Document(d)) = m.media {
                    if let tl::enums::Document::Document(doc) = d.document.unwrap() {
                        let name = doc.attributes.iter().find_map(|a| match a {
                            tl::enums::DocumentAttribute::Filename(f) => Some(f.file_name.clone()),
                            _ => None
                        }).unwrap_or("Unknown".to_string());
                        let size = doc.size as u64;
                        let mime = doc.mime_type.clone();
                        let ext = std::path::Path::new(&name).extension().map(|os| os.to_str().unwrap_or("").to_string());
                        let folder_id = match m.peer_id {
                            tl::enums::Peer::Channel(c) => Some(c.channel_id),
                            tl::enums::Peer::User(u) => Some(u.user_id),
                            tl::enums::Peer::Chat(c) => Some(c.chat_id),
                        };
                        files.push(FileMetadata {
                            id: m.id as i64, folder_id, name, size,
                            mime_type: Some(mime), file_ext: ext,
                            created_at: m.date.to_string(), date_raw: m.date,
                            note_id: m.id.to_string(), folder_name: None,
                            icon_type: "file".into(),
                            url: None, caption: None, og_title: None, og_description: None,
                            og_site_name: None, has_telegram_thumb: false,
                        });
                    }
                }
            }
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn cmd_scan_folders(
    state: State<'_, TelegramState>,
) -> Result<Vec<FolderMetadata>, String> {
    let client_opt = { state.client.lock().await.clone() };
    if client_opt.is_none() { 
        return Ok(Vec::new());
    }
    let client = client_opt.unwrap();
    
    let mut folders = Vec::new();
    let mut dialogs = client.iter_dialogs();
    
    log::info!("Starting Folder Scan...");

    // Acquire write lock once for the entire scan to populate the peer cache
    let mut peer_cache = state.peer_cache.write().await;

    while let Some(dialog) = dialogs.next().await.map_err(|e| e.to_string())? {
        // Populate peer cache for every dialog we encounter (free priming)
        match &dialog.peer {
            Peer::Channel(c) => {
                let id = c.raw.id;
                peer_cache.insert(id, dialog.peer.clone());

                let name = c.raw.title.clone();
                let access_hash = c.raw.access_hash.unwrap_or(0);
                
                log::debug!("[SCAN] Processing Channel: '{}' (ID: {})", name, id);

                // Strategy 1: Title
                if name.to_lowercase().contains("[td]") {
                    log::info!(" -> MATCH via Title: {}", name);
                    let display_name = name.replace(" [TD]", "").replace(" [td]", "").replace("[TD]", "").replace("[td]", "").trim().to_string();
                    folders.push(FolderMetadata { id, name: display_name, parent_id: None });
                    continue; 
                }

                // Strategy 2: About
                let input_chan = tl::enums::InputChannel::Channel(tl::types::InputChannel {
                    channel_id: c.raw.id,
                    access_hash,
                });
                
                match client.invoke(&tl::functions::channels::GetFullChannel {
                    channel: input_chan,
                }).await {
                    Ok(tl::enums::messages::ChatFull::Full(f)) => {
                        if let tl::enums::ChatFull::Full(cf) = f.full_chat {
                             if cf.about.contains("[telegram-drive-folder]") {
                                 log::info!(" -> MATCH via About: {}", name);
                                 folders.push(FolderMetadata { id, name: name.clone(), parent_id: None });
                             }
                        }
                    },
                    Err(e) => log::warn!(" -> Failed to get full info: {}", e),
                }
            },
            Peer::User(u) => {
                peer_cache.insert(u.raw.id(), dialog.peer.clone());
                log::debug!("[SCAN] Cached User Peer: {}", u.raw.id());
            },
            peer => {
                log::debug!("[SCAN] Skipped Peer: {:?}", peer);
            }
        }
    }
    
    log::info!("Scan complete. Found {} folders. Peer cache size: {}.", folders.len(), peer_cache.len());
    Ok(folders)
}
