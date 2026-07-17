use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarLaunch {
    program: PathBuf,
    args: Vec<OsString>,
    root: PathBuf,
}

impl SidecarLaunch {
    pub fn development(entry: PathBuf, explicit_node: Option<PathBuf>) -> Result<Self, String> {
        let root = entry
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        Self::development_at_root(root, entry, explicit_node)
    }

    pub fn development_at_root(
        root: PathBuf,
        entry: PathBuf,
        explicit_node: Option<PathBuf>,
    ) -> Result<Self, String> {
        let (program, program_file_label) = match explicit_node {
            Some(program) => (program, Some("CALEN_STOCK_NODE")),
            None => (PathBuf::from("node"), None),
        };
        checked_sidecar_launch(
            program,
            entry,
            root,
            program_file_label,
            "CALEN_STOCK_SIDECAR_ENTRY",
        )
    }

    pub fn installed(root: &Path) -> Result<Self, String> {
        checked_sidecar_launch(
            root.join(if cfg!(target_os = "windows") {
                "node.exe"
            } else {
                "node"
            }),
            root.join("dist").join("stdio.mjs"),
            root.to_path_buf(),
            Some("安装包内置 Node"),
            "安装包股票入口",
        )
    }

    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .current_dir(&self.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
        }

        command
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    pub fn args(&self) -> &[OsString] {
        &self.args
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[cfg(target_os = "windows")]
pub fn normalize_node_launch_path(path: &Path) -> Result<PathBuf, String> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Component, Prefix};

    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return Ok(path.to_path_buf());
    };

    let encoded = path.as_os_str().encode_wide().collect::<Vec<_>>();
    match prefix.kind() {
        Prefix::VerbatimDisk(_) => {
            const VERBATIM_PREFIX_LEN: usize = 4;
            if encoded.len() <= VERBATIM_PREFIX_LEN {
                return Err(format!(
                    "股票 sidecar 路径不是有效的 Windows 绝对路径：{}",
                    path.display()
                ));
            }
            let normalized = PathBuf::from(OsString::from_wide(&encoded[VERBATIM_PREFIX_LEN..]));
            if !normalized.is_absolute() {
                return Err(format!(
                    "股票 sidecar 路径不是有效的 Windows 绝对路径：{}",
                    path.display()
                ));
            }
            Ok(normalized)
        }
        Prefix::VerbatimUNC(_, _) => {
            const VERBATIM_UNC_PREFIX_LEN: usize = 8;
            if encoded.len() <= VERBATIM_UNC_PREFIX_LEN {
                return Err(format!("股票 sidecar UNC 路径无效：{}", path.display()));
            }
            let mut normalized = vec![b'\\' as u16, b'\\' as u16];
            normalized.extend_from_slice(&encoded[VERBATIM_UNC_PREFIX_LEN..]);
            Ok(PathBuf::from(OsString::from_wide(&normalized)))
        }
        Prefix::Verbatim(_) | Prefix::DeviceNS(_) => Err(format!(
            "股票 sidecar 不支持 Windows 设备命名空间路径：{}",
            path.display()
        )),
        Prefix::UNC(_, _) | Prefix::Disk(_) => Ok(path.to_path_buf()),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn normalize_node_launch_path(path: &Path) -> Result<PathBuf, String> {
    Ok(path.to_path_buf())
}

fn checked_sidecar_launch(
    program: PathBuf,
    entry: PathBuf,
    root: PathBuf,
    program_file_label: Option<&str>,
    entry_file_label: &str,
) -> Result<SidecarLaunch, String> {
    let program = normalize_node_launch_path(&program)?;
    let entry = normalize_node_launch_path(&entry)?;
    let root = normalize_node_launch_path(&root)?;

    if !root.is_dir() {
        return Err(format!(
            "股票 sidecar 工作目录不存在或不是目录：{}",
            root.display()
        ));
    }
    if !entry.is_file() {
        return Err(format!(
            "{entry_file_label} 必须指向现有文件：{}",
            entry.display()
        ));
    }
    if let Some(label) = program_file_label {
        if !program.is_file() {
            return Err(format!("{label} 必须指向现有文件：{}", program.display()));
        }
    }

    Ok(SidecarLaunch {
        program,
        args: vec![entry.into_os_string()],
        root,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_override_requires_existing_entry_and_explicit_node_files() {
        let root = tempfile::tempdir().expect("create sidecar launch test directory");
        let missing_entry = root.path().join("missing-stdio.mjs");
        let error = SidecarLaunch::development(missing_entry.clone(), None)
            .expect_err("missing override entry must fail before spawn");
        assert!(error.contains("CALEN_STOCK_SIDECAR_ENTRY"));
        assert!(error.contains(&missing_entry.to_string_lossy().into_owned()));

        let entry = root.path().join("stdio.mjs");
        std::fs::write(&entry, b"entry placeholder").expect("write override entry");
        let missing_node = root.path().join("missing-node.exe");
        let error = SidecarLaunch::development(entry, Some(missing_node.clone()))
            .expect_err("missing explicit node executable must fail before spawn");
        assert!(error.contains("CALEN_STOCK_NODE"));
        assert!(error.contains(&missing_node.to_string_lossy().into_owned()));
    }

    #[test]
    fn development_launch_can_preserve_an_explicit_working_directory() {
        let root = tempfile::tempdir().expect("create sidecar launch test directory");
        let entry = root.path().join("dist").join("stdio.mjs");
        std::fs::create_dir_all(entry.parent().expect("entry parent"))
            .expect("create sidecar dist directory");
        std::fs::write(&entry, b"entry placeholder").expect("write sidecar entry");

        let launch =
            SidecarLaunch::development_at_root(root.path().to_path_buf(), entry.clone(), None)
                .expect("build development launch");

        assert_eq!(launch.root(), root.path());
        assert_eq!(launch.args(), [entry.into_os_string()]);
    }

    #[cfg(target_os = "windows")]
    mod windows {
        use super::*;
        use calen_stock_process_tree::StockProcessTree;
        use serde_json::{json, Value};
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        use std::time::Duration;
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
        use tokio::time::timeout;

        fn windows_verbatim_path(path: &Path) -> PathBuf {
            let mut encoded = r"\\?\".encode_utf16().collect::<Vec<_>>();
            encoded.extend(path.as_os_str().encode_wide());
            PathBuf::from(OsString::from_wide(&encoded))
        }

        async fn request_status(
            stdin: &mut tokio::process::ChildStdin,
            stdout: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
            request_id: &str,
        ) -> Value {
            let mut frame = serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "status",
                "params": {}
            }))
            .expect("serialize status request");
            frame.push(b'\n');
            stdin.write_all(&frame).await.expect("write status frame");
            stdin.flush().await.expect("flush status frame");

            loop {
                let line = timeout(Duration::from_secs(10), stdout.next_line())
                    .await
                    .expect("stock sidecar status response timed out")
                    .expect("read stock sidecar status response")
                    .expect("stock sidecar closed stdout before status response");
                let response: Value =
                    serde_json::from_str(&line).expect("parse stock sidecar JSON-RPC response");
                if response.get("id").and_then(Value::as_str) == Some(request_id) {
                    return response;
                }
            }
        }

        #[test]
        fn node_launch_paths_convert_supported_windows_verbatim_namespaces() {
            assert_eq!(
                normalize_node_launch_path(Path::new(
                    r"\\?\D:\Calen 股票\stock sidecar\dist\stdio.mjs",
                ))
                .expect("drive-letter verbatim path should be supported"),
                PathBuf::from(r"D:\Calen 股票\stock sidecar\dist\stdio.mjs")
            );
            assert_eq!(
                normalize_node_launch_path(Path::new(
                    r"\\?\UNC\server\共享目录\Calen\dist\stdio.mjs",
                ))
                .expect("UNC verbatim path should be supported"),
                PathBuf::from(r"\\server\共享目录\Calen\dist\stdio.mjs")
            );
        }

        #[test]
        fn node_launch_paths_preserve_ordinary_unicode_and_space_paths() {
            let ordinary = Path::new(r"D:\应用目录\Calen 股票\dist\stdio.mjs");
            assert_eq!(
                normalize_node_launch_path(ordinary).expect("ordinary path should be supported"),
                ordinary
            );
        }

        #[test]
        fn node_launch_paths_reject_device_namespaces() {
            let error = normalize_node_launch_path(Path::new(r"\\.\PIPE\calen-stock"))
                .expect_err("device namespace must not be passed to Node");
            assert!(error.contains("设备命名空间"));
            assert!(error.contains(r"\\.\PIPE\calen-stock"));

            let error = normalize_node_launch_path(Path::new(r"\\?\GLOBALROOT\Device\Harddisk0"))
                .expect_err("arbitrary verbatim namespace must not be passed to Node");
            assert!(error.contains("设备命名空间"));
        }

        #[test]
        fn installed_launch_normalizes_every_node_facing_path() {
            let install = tempfile::Builder::new()
                .prefix("Calen 股票 启动路径 ")
                .tempdir()
                .expect("create installed sidecar test directory");
            let root = install.path().join("stock-sidecar");
            std::fs::create_dir_all(root.join("dist")).expect("create installed sidecar folders");
            std::fs::write(root.join("node.exe"), b"node placeholder")
                .expect("write node placeholder");
            std::fs::write(root.join("dist").join("stdio.mjs"), b"entry placeholder")
                .expect("write entry placeholder");

            let launch = SidecarLaunch::installed(&windows_verbatim_path(&root))
                .expect("installed launch should accept a verbatim resource path");
            assert_eq!(launch.program(), root.join("node.exe"));
            assert_eq!(launch.root(), root);
            assert_eq!(
                launch.args(),
                [root.join("dist").join("stdio.mjs").into_os_string()]
            );
        }

        #[tokio::test]
        #[ignore = "requires CALEN_STOCK_WINDOWS_INSTALL_ROOT pointing at staged stock-sidecar"]
        async fn packaged_sidecar_uses_production_launch_and_stdio() {
            let root = PathBuf::from(
                std::env::var_os("CALEN_STOCK_WINDOWS_INSTALL_ROOT")
                    .expect("set CALEN_STOCK_WINDOWS_INSTALL_ROOT"),
            );
            let manager_root = root
                .canonicalize()
                .expect("canonicalize staged sidecar like Tauri resource_dir");
            assert!(manager_root.to_string_lossy().starts_with(r"\\?\"));

            let launch = SidecarLaunch::installed(&manager_root)
                .expect("build production launch from verbatim resource path");
            let data_dir = tempfile::Builder::new()
                .prefix("Calen 股票 Runtime ")
                .tempdir()
                .expect("create sidecar data directory");
            let mut command = launch.command();
            command
                .env("CALEN_STOCK_DATA_DIR", data_dir.path())
                .env(
                    "CALEN_STOCK_SETTINGS",
                    json!({ "enabled": true, "providers": [] }).to_string(),
                )
                .env_remove("CALEN_STOCK_PROVIDER_KEYS");

            let mut child = command.spawn().expect("spawn packaged stock sidecar");
            let process_id = child.id().expect("packaged sidecar process id");
            let process_tree =
                StockProcessTree::attach(process_id).expect("attach packaged sidecar Job Object");
            let mut stdin = child.stdin.take().expect("packaged sidecar stdin");
            let stdout = child.stdout.take().expect("packaged sidecar stdout");
            let mut stdout = BufReader::new(stdout).lines();
            let mut stderr = child.stderr.take().expect("packaged sidecar stderr");
            let stderr_task = tokio::spawn(async move {
                let mut output = String::new();
                let _ = stderr.read_to_string(&mut output).await;
                output
            });

            let first = request_status(&mut stdin, &mut stdout, "runtime-smoke-first").await;
            assert!(first.get("result").is_some_and(Value::is_object));
            let second = request_status(&mut stdin, &mut stdout, "runtime-smoke-second").await;
            assert!(second.get("result").is_some_and(Value::is_object));

            process_tree
                .terminate()
                .expect("terminate packaged sidecar Job Object");
            timeout(Duration::from_secs(5), child.wait())
                .await
                .expect("packaged sidecar termination timed out")
                .expect("wait for packaged sidecar termination");
            let stderr_tail = stderr_task.await.expect("join sidecar stderr collector");
            assert!(
                !stderr_tail.contains("EISDIR") && !stderr_tail.contains("lstat 'D:'"),
                "packaged sidecar regressed to the Node verbatim path bug: {stderr_tail}"
            );
        }
    }
}
