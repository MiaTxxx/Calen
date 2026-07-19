fn validate_chat_composer_draft_input(input: &ChatComposerDraftInput) -> Result<(), String> {
    if input.conversation_id.trim().is_empty() {
        return Err("草稿 conversationId 不能为空".to_string());
    }
    let draft = serde_json::from_str::<Value>(&input.draft_json)
        .map_err(|error| format!("草稿 draftJson 无效：{error}"))?;
    if !draft.is_object() {
        return Err("草稿 draftJson 必须是对象".to_string());
    }
    let uploaded_files = serde_json::from_str::<Value>(&input.uploaded_files_json)
        .map_err(|error| format!("草稿 uploadedFilesJson 无效：{error}"))?;
    if !uploaded_files.is_array() {
        return Err("草稿 uploadedFilesJson 必须是数组".to_string());
    }
    Ok(())
}

fn row_to_chat_composer_draft(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ChatComposerDraftRecord> {
    Ok(ChatComposerDraftRecord {
        conversation_id: row.get("conversation_id")?,
        workdir: row.get("workdir")?,
        draft_json: row.get("draft_json")?,
        uploaded_files_json: row.get("uploaded_files_json")?,
        preview: row.get("preview")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn upsert_chat_composer_draft_sync(
    conn: &Connection,
    input: &ChatComposerDraftInput,
) -> Result<ChatComposerDraftRecord, String> {
    validate_chat_composer_draft_input(input)?;
    let conversation_id = input.conversation_id.trim();
    let updated_at = if input.updated_at > 0 {
        input.updated_at
    } else {
        now_ms()
    };
    conn.execute(
        "
        INSERT INTO chatComposerDraft (
            conversation_id, workdir, draft_json, uploaded_files_json, preview, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ON CONFLICT(conversation_id) DO UPDATE SET
            workdir = excluded.workdir,
            draft_json = excluded.draft_json,
            uploaded_files_json = excluded.uploaded_files_json,
            preview = excluded.preview,
            updated_at = excluded.updated_at
        ",
        params![
            conversation_id,
            input.workdir.trim(),
            input.draft_json.trim(),
            input.uploaded_files_json.trim(),
            input.preview.trim(),
            updated_at,
        ],
    )
    .map_err(|error| format!("保存聊天草稿失败：{error}"))?;
    get_chat_composer_draft_sync(conn, conversation_id)?
        .ok_or_else(|| "保存聊天草稿后未找到记录".to_string())
}

fn get_chat_composer_draft_sync(
    conn: &Connection,
    conversation_id: &str,
) -> Result<Option<ChatComposerDraftRecord>, String> {
    let conversation_id = conversation_id.trim();
    if conversation_id.is_empty() {
        return Ok(None);
    }
    conn.query_row(
        "
        SELECT conversation_id, workdir, draft_json, uploaded_files_json, preview, created_at, updated_at
        FROM chatComposerDraft
        WHERE conversation_id = ?1
        ",
        params![conversation_id],
        row_to_chat_composer_draft,
    )
    .optional()
    .map_err(|error| format!("读取聊天草稿失败：{error}"))
}

fn list_chat_composer_drafts_sync(
    conn: &Connection,
) -> Result<Vec<ChatComposerDraftRecord>, String> {
    let mut statement = conn
        .prepare(
            "
            SELECT conversation_id, workdir, draft_json, uploaded_files_json, preview, created_at, updated_at
            FROM chatComposerDraft
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| format!("准备聊天草稿列表失败：{error}"))?;
    let rows = statement
        .query_map([], row_to_chat_composer_draft)
        .map_err(|error| format!("查询聊天草稿列表失败：{error}"))?;
    rows.map(|row| row.map_err(|error| format!("读取聊天草稿列表失败：{error}")))
        .collect()
}

fn delete_chat_composer_draft_sync(
    conn: &Connection,
    conversation_id: &str,
) -> Result<(), String> {
    let conversation_id = conversation_id.trim();
    if conversation_id.is_empty() {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM chatComposerDraft WHERE conversation_id = ?1",
        params![conversation_id],
    )
    .map_err(|error| format!("删除聊天草稿失败：{error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn chat_composer_draft_list() -> Result<Vec<ChatComposerDraftRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        list_chat_composer_drafts_sync(&conn)
    })
    .await
    .map_err(|error| format!("chat_composer_draft_list join 失败：{error}"))?
}

#[tauri::command]
pub async fn chat_composer_draft_get(
    conversation_id: String,
) -> Result<Option<ChatComposerDraftRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        get_chat_composer_draft_sync(&conn, &conversation_id)
    })
    .await
    .map_err(|error| format!("chat_composer_draft_get join 失败：{error}"))?
}

#[tauri::command]
pub async fn chat_composer_draft_upsert(
    input: ChatComposerDraftInput,
) -> Result<ChatComposerDraftRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        upsert_chat_composer_draft_sync(&conn, &input)
    })
    .await
    .map_err(|error| format!("chat_composer_draft_upsert join 失败：{error}"))?
}

#[tauri::command]
pub async fn chat_composer_draft_delete(conversation_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        delete_chat_composer_draft_sync(&conn, &conversation_id)
    })
    .await
    .map_err(|error| format!("chat_composer_draft_delete join 失败：{error}"))?
}

#[tauri::command]
pub async fn chat_composer_draft_clear() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        conn.execute("DELETE FROM chatComposerDraft", [])
            .map_err(|error| format!("清空聊天草稿失败：{error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("chat_composer_draft_clear join 失败：{error}"))?
}
