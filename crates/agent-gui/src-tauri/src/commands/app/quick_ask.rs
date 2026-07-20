//! Quick Ask（截屏即问）：全局快捷键 → 截取光标所在屏幕 → 框选 → 置顶小窗直接问 AI。
//!
//! 流程状态都保存在 `QuickAskManager` 里：
//! 1. 快捷键触发后先整屏截图（避免遮罩窗把自己截进去），存入 `capture`；
//! 2. 遮罩窗（snip-overlay）读取整屏图做框选，确认后 Rust 裁剪出选区 PNG 存入 `pending`；
//! 3. 快捷问答窗（quick-ask）启动时取走 `pending`，之后模型调用完全复用前端已有的
//!    provider 流式管线，Rust 不参与对话。

use std::io::Cursor;
use std::sync::Mutex;

use base64::Engine;
use image::RgbaImage;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const OVERLAY_WINDOW_LABEL: &str = "snip-overlay";
pub const QUICK_ASK_WINDOW_LABEL: &str = "quick-ask";
pub const DEFAULT_QUICK_ASK_HOTKEY: &str = "CmdOrCtrl+Shift+A";
/// 已有小窗打开时，新截图通过该事件通知前端重新拉取 pending。
const QUICK_ASK_NEW_SHOT_EVENT: &str = "quick-ask:new-shot";

const QUICK_ASK_WINDOW_WIDTH: f64 = 440.0;
const QUICK_ASK_WINDOW_HEIGHT: f64 = 580.0;

struct CaptureSession {
    image: RgbaImage,
    /// 显示器物理位置与尺寸（物理像素），用于摆放遮罩窗和裁剪换算。
    monitor_x: i32,
    monitor_y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Default)]
pub struct QuickAskManager {
    capture: Mutex<Option<CaptureSession>>,
    pending: Mutex<Option<String>>,
    registered_hotkey: Mutex<Option<Shortcut>>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPayload {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingShot {
    pub image_data_url: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

fn encode_png_data_url(image: &RgbaImage) -> Result<String, String> {
    let mut bytes = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
        .map_err(|e| format!("编码截图 PNG 失败：{e}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn capture_monitor_at_cursor(app: &AppHandle) -> Result<CaptureSession, String> {
    let cursor = app
        .cursor_position()
        .map_err(|e| format!("读取鼠标位置失败：{e}"))?;
    let monitor = match xcap::Monitor::from_point(cursor.x as i32, cursor.y as i32) {
        Ok(monitor) => monitor,
        Err(_) => xcap::Monitor::all()
            .map_err(|e| format!("枚举显示器失败：{e}"))?
            .into_iter()
            .next()
            .ok_or("未找到可截屏的显示器")?,
    };
    let image = monitor
        .capture_image()
        .map_err(|e| format!("屏幕截图失败：{e}"))?;
    let monitor_x = monitor
        .x()
        .map_err(|e| format!("读取显示器位置失败：{e}"))?;
    let monitor_y = monitor
        .y()
        .map_err(|e| format!("读取显示器位置失败：{e}"))?;
    let scale_factor = monitor
        .scale_factor()
        .map(f64::from)
        .unwrap_or(1.0)
        .max(0.5);
    Ok(CaptureSession {
        monitor_x,
        monitor_y,
        width: image.width(),
        height: image.height(),
        scale_factor,
        image,
    })
}

fn open_overlay_window(app: &AppHandle, session: &CaptureSession) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let _ = existing.destroy();
    }
    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Calen 截屏")
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .build()
    .map_err(|e| format!("创建截屏遮罩窗失败：{e}"))?;
    // 保持隐藏：等前端加载完截图后调用 quick_ask_overlay_ready 再显示，
    // 避免出现"遮罩已显示但还不能拖拽"的窗口期。
    window
        .set_position(PhysicalPosition::new(session.monitor_x, session.monitor_y))
        .and_then(|_| window.set_size(PhysicalSize::new(session.width, session.height)))
        .map_err(|e| format!("布置截屏遮罩窗失败：{e}"))?;
    Ok(())
}

fn open_quick_ask_window(app: &AppHandle) -> Result<bool, String> {
    if let Some(existing) = app.get_webview_window(QUICK_ASK_WINDOW_LABEL) {
        existing.show().map_err(|e| e.to_string())?;
        existing.unminimize().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(true);
    }
    let window = WebviewWindowBuilder::new(
        app,
        QUICK_ASK_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Calen 快捷提问")
    .inner_size(QUICK_ASK_WINDOW_WIDTH, QUICK_ASK_WINDOW_HEIGHT)
    .min_inner_size(320.0, 400.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(false)
    .visible(false)
    .build()
    .map_err(|e| format!("创建快捷提问窗失败：{e}"))?;
    // 靠近光标弹出，但整体收在光标所在显示器内。
    if let Ok(cursor) = app.cursor_position() {
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            let scale = monitor.scale_factor();
            let bounds_pos = monitor.position().to_logical::<f64>(scale);
            let bounds_size = monitor.size().to_logical::<f64>(scale);
            let cursor_logical = LogicalPosition::new(cursor.x / scale, cursor.y / scale);
            let x = (cursor_logical.x + 16.0)
                .min(bounds_pos.x + bounds_size.width - QUICK_ASK_WINDOW_WIDTH - 16.0)
                .max(bounds_pos.x + 16.0);
            let y = (cursor_logical.y + 16.0)
                .min(bounds_pos.y + bounds_size.height - QUICK_ASK_WINDOW_HEIGHT - 16.0)
                .max(bounds_pos.y + 16.0);
            let _ = window.set_position(LogicalPosition::new(x, y));
            let _ = window.set_size(LogicalSize::new(
                QUICK_ASK_WINDOW_WIDTH,
                QUICK_ASK_WINDOW_HEIGHT,
            ));
        }
    }
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|e| format!("显示快捷提问窗失败：{e}"))?;
    Ok(false)
}

/// 全局快捷键回调入口：截屏并弹出框选遮罩。必须在主线程创建窗口。
pub fn trigger_quick_ask(app: &AppHandle) {
    let handle = app.clone();
    let app = app.clone();
    let run = move || {
        if let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            // 已在框选中：再次按下快捷键视为取消（销毁在本轮事件循环稍后完成，
            // 同一回合内用相同 label 重建会失败，所以这里只取消不重建）。
            let manager = app.state::<QuickAskManager>();
            *manager.capture.lock().unwrap() = None;
            let _ = overlay.destroy();
            return;
        }
        let manager = app.state::<QuickAskManager>();
        match capture_monitor_at_cursor(&app) {
            Ok(session) => {
                if let Err(error) = open_overlay_window(&app, &session) {
                    eprintln!("quick ask overlay error: {error}");
                    return;
                }
                *manager.capture.lock().unwrap() = Some(session);
            }
            Err(error) => eprintln!("quick ask capture error: {error}"),
        }
    };
    if let Err(error) = handle.run_on_main_thread(run) {
        eprintln!("quick ask trigger error: {error}");
    }
}

/// 按设置里的快捷键（重新）注册全局热键；空字符串表示禁用。
pub fn sync_hotkey_registration(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let manager = app.state::<QuickAskManager>();
    let mut registered = manager.registered_hotkey.lock().unwrap();
    if let Some(previous) = registered.take() {
        let _ = app.global_shortcut().unregister(previous);
    }
    let hotkey = hotkey.trim();
    if hotkey.is_empty() {
        return Ok(());
    }
    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| format!("快捷键格式无效（{hotkey}）：{e}"))?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                trigger_quick_ask(app);
            }
        })
        .map_err(|e| format!("注册全局快捷键失败（{hotkey}）：{e}"))?;
    *registered = Some(shortcut);
    Ok(())
}

// 注意：以下涉及创建/销毁窗口的命令必须是 async。
// Tauri v2 的同步命令在主线程的 IPC 分发中执行，在 Windows 上重入式创建/销毁
// webview 窗口不会生效（窗口停留在不可见状态）；async 命令跑在 tokio 工作线程，
// 窗口操作会正确派发回事件循环。overlay_payload 虽不动窗口，但 PNG 编码较重，
// 同样放到工作线程避免阻塞 UI。
#[tauri::command]
pub async fn quick_ask_overlay_payload(
    manager: tauri::State<'_, QuickAskManager>,
) -> Result<OverlayPayload, String> {
    let capture = manager.capture.lock().unwrap();
    let session = capture.as_ref().ok_or("当前没有待框选的截图")?;
    Ok(OverlayPayload {
        image_data_url: encode_png_data_url(&session.image)?,
        width: session.width,
        height: session.height,
        scale_factor: session.scale_factor,
    })
}

#[tauri::command]
pub async fn quick_ask_confirm_selection(
    app: AppHandle,
    manager: tauri::State<'_, QuickAskManager>,
    selection: SelectionRect,
) -> Result<(), String> {
    let cropped = {
        let mut capture = manager.capture.lock().unwrap();
        let session = capture.as_ref().ok_or("截图会话已失效，请重新按快捷键")?;
        let x = selection.x.clamp(0, session.width.saturating_sub(1) as i32) as u32;
        let y = selection
            .y
            .clamp(0, session.height.saturating_sub(1) as i32) as u32;
        let width = selection.width.clamp(1, session.width - x);
        let height = selection.height.clamp(1, session.height - y);
        let view = image::imageops::crop_imm(&session.image, x, y, width, height).to_image();
        *capture = None;
        view
    };
    *manager.pending.lock().unwrap() = Some(encode_png_data_url(&cropped)?);

    // 销毁遮罩与创建小窗都放回主线程的事件循环回合里执行（与遮罩窗的创建
    // 路径一致）；从 tokio 工作线程直接 build 窗口在 Windows 上会卡住不返回。
    let main_thread_app = app.clone();
    app.run_on_main_thread(move || {
        if let Some(overlay) = main_thread_app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            let _ = overlay.destroy();
        }
        match open_quick_ask_window(&main_thread_app) {
            Ok(true) => {
                if let Err(error) =
                    main_thread_app.emit_to(QUICK_ASK_WINDOW_LABEL, QUICK_ASK_NEW_SHOT_EVENT, ())
                {
                    eprintln!("[quick-ask] notify ask window failed: {error}");
                }
            }
            Ok(false) => {}
            Err(error) => eprintln!("[quick-ask] open ask window failed: {error}"),
        }
    })
    .map_err(|e| format!("调度快捷提问窗失败：{e}"))?;
    Ok(())
}

/// 遮罩前端渲染完截图后调用：此刻才把遮罩显示出来，保证一出现即可框选。
#[tauri::command]
pub async fn quick_ask_overlay_ready(app: AppHandle) -> Result<(), String> {
    let main_thread_app = app.clone();
    app.run_on_main_thread(move || {
        if let Some(overlay) = main_thread_app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            if let Err(error) = overlay.show().and_then(|_| overlay.set_focus()) {
                eprintln!("[quick-ask] show overlay failed: {error}");
            }
        }
    })
    .map_err(|e| format!("调度显示截屏遮罩失败：{e}"))
}

#[tauri::command]
pub async fn quick_ask_cancel_overlay(
    app: AppHandle,
    manager: tauri::State<'_, QuickAskManager>,
) -> Result<(), String> {
    *manager.capture.lock().unwrap() = None;
    if let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let _ = overlay.destroy();
    }
    Ok(())
}

#[tauri::command]
pub fn quick_ask_take_pending(
    manager: tauri::State<'_, QuickAskManager>,
) -> Result<Option<PendingShot>, String> {
    Ok(manager
        .pending
        .lock()
        .unwrap()
        .take()
        .map(|image_data_url| PendingShot { image_data_url }))
}

#[tauri::command]
pub async fn quick_ask_close_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(QUICK_ASK_WINDOW_LABEL) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn quick_ask_apply_hotkey(app: AppHandle, hotkey: String) -> Result<(), String> {
    sync_hotkey_registration(&app, &hotkey)
}

#[tauri::command]
pub async fn quick_ask_open_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
