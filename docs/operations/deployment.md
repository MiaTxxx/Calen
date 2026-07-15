# CI/CD 与发布

本文档描述当前自动化发布链路：CI 检查、Gateway Docker 镜像、用户自部署 Gateway，以及桌面端 Windows x64 Release。

## 自动化入口

| 入口                    | Workflow                                | 动作                                                                                                |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| PR / `main` push        | `.github/workflows/ci.yml`              | 跑 Gateway、WebUI、GUI、Tauri Rust 测试和 proto 一致性检查。                                        |
| `v*` tag / 手动指定 tag | `.github/workflows/gateway-docker.yml`  | 构建并推送 `vX.Y.Z` 与 `latest` Gateway 镜像。                                                      |
| `v*` tag / 手动指定 tag | `.github/workflows/desktop-release.yml` | 构建 Windows x64 的 Setup.exe、MSI、签名和 Windows-only updater manifest，并上传到 GitHub Release。 |

## Gateway 镜像

根目录 `Dockerfile` 是 Gateway 的生产镜像：

| 阶段              | 内容                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `webui`           | 用 Node 22 和 pnpm 构建 `crates/agent-gateway/web/dist`。            |
| `gateway-builder` | 用 Go 编译 `cmd/gateway`，WebUI 静态资源通过 `go:embed` 打进二进制。 |
| `runtime`         | Debian slim + CA certificates + `calen-gateway`，非 root 用户运行。  |

运行时变量：

| 变量                                          | 必填             | 说明                                                                                       |
| --------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `LIVEAGENT_GATEWAY_TOKEN`                     | 是               | WebUI、HTTP API、桌面 gRPC 的共享访问 token。                                              |
| `PORT`                                        | Railway 自动提供 | HTTP/WebUI 监听端口，未提供时 Dockerfile 默认 `8080`。                                     |
| `LIVEAGENT_GATEWAY_GRPC_ADDR`                 | 否               | gRPC 监听地址，默认 `:50051`。                                                             |
| `LIVEAGENT_GATEWAY_CHAT_PREPARE_TIMEOUT`      | 否               | `chat.prepare` 与 command accepted 前关联原生 Ping/Pong 的最大等待时间，默认 `2s`。        |
| `LIVEAGENT_GATEWAY_CHAT_DELIVERY_TIMEOUT`     | 否               | accepted 后把 `ChatCommandRequest` 投递到当前桌面 Agent stream 的最大等待时间，默认 `5s`。 |
| `LIVEAGENT_GATEWAY_CHAT_START_TIMEOUT`        | 否               | Chat command 进入桌面运行态的第一段 watchdog，默认 `5s`。                                  |
| `LIVEAGENT_GATEWAY_CHAT_RENDER_START_TIMEOUT` | 否               | 第一段 watchdog 后继续等待桌面 run settled 的附加窗口，默认 `10s`。                        |

本地 smoke run 示例：

```bash
make gateway-docker-smoke
```

CI 中的 `Gateway Docker Smoke` job 会执行同等检查：构建镜像、启动容器、访问 `/healthz`。

## 用户自部署 Gateway

Calen 不提供托管 Gateway 服务。需要公网 Remote Gateway 的用户可以用自己的 Railway 账号部署本仓库，或在其他 Docker 平台部署 `ghcr.io/miatxxx/calen-gateway:vX.Y.Z` / `latest` 镜像。

Railway 自部署路径：

1. 在 Railway 新建项目，选择 GitHub Repository。
2. 选择 `MiaTxxx/Calen` 或用户自己的 fork。
3. 分支选择包含根目录 `Dockerfile` 和 `railway.json` 的分支。
4. 在 service variables 中设置 `LIVEAGENT_GATEWAY_TOKEN=<long-random-token>`。
5. 保持 `LIVEAGENT_GATEWAY_GRPC_ADDR=:50051`，或按平台 TCP Proxy 要求调整。
6. 部署成功后生成 Public Domain，并访问 `/healthz` 验证健康检查。

推荐生产部署模型：

| 流量                     | Railway 能力                 | Remote 配置                                              |
| ------------------------ | ---------------------------- | -------------------------------------------------------- |
| WebUI / HTTP / WebSocket | Public Networking HTTPS 域名 | `Gateway URL=https://<service>.up.railway.app`           |
| 桌面端 gRPC              | TCP Proxy                    | `gRPC Endpoint=http://<tcp-proxy-host>:<tcp-proxy-port>` |

Gateway WebUI 和桌面 gRPC 地址分开后，Railway 的 HTTPS 域名和 TCP Proxy 地址可以独立配置。

Gateway 运行时变量由用户在自己的平台配置：

| 变量                                          | 说明                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `LIVEAGENT_GATEWAY_TOKEN`                     | WebUI、HTTP API、桌面 gRPC 的共享访问 token。                   |
| `LIVEAGENT_GATEWAY_GRPC_ADDR`                 | 保持 `:50051`，供 Railway TCP Proxy 转发。                      |
| `LIVEAGENT_GATEWAY_CHAT_PREPARE_TIMEOUT`      | 默认 `2s`；通常无需调大，超时应暴露半开连接并让客户端快速恢复。 |
| `LIVEAGENT_GATEWAY_CHAT_DELIVERY_TIMEOUT`     | 默认 `5s`；控制 accepted 后投递桌面 stream 的上限。             |
| `LIVEAGENT_GATEWAY_CHAT_START_TIMEOUT`        | 默认 `5s`；控制远程 command 启动 watchdog 的第一阶段。          |
| `LIVEAGENT_GATEWAY_CHAT_RENDER_START_TIMEOUT` | 默认 `10s`；控制启动 watchdog 的附加阶段。                      |

Gateway 的 conversation stream replay 与 `client_request_id` 去重当前都是进程内有界状态，不需要 SQLite 持久卷。事件窗口默认保留最近 10 分钟、最多 4096 条或约 8 MiB；command 去重记录保留 24 小时，但 Gateway 进程重启后不会保留。

## GitHub Variables 与 Secrets

公开桌面 Release 必须先完成股票数据源条款审核，并在仓库 `Settings -> Secrets and variables -> Actions` 配置：

| 类型     | 名称                                  | 说明                                                                          |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| Variable | `CALEN_STOCK_PROVIDER_TERMS_APPROVED` | 仅在取得书面授权或正式合规批准后设置为 `true`；否则 workflow 会在构建前停止。 |
| Secret   | `TAURI_SIGNING_PRIVATE_KEY`           | Tauri updater 私钥，用于生成安装器和 updater 产物的签名。                     |
| Secret   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | Tauri updater 私钥密码；私钥无密码时可为空。                                  |
| Secret   | `TAURI_UPDATER_PUBLIC_KEY`            | Tauri updater 公钥，会注入 Tauri 配置并编译进桌面端，用于校验更新包。         |

Provider 条款依据、上线边界和停止条件见 `docs/provider-compliance-review.md`。首版不配置 Authenticode 证书，因此 Windows 可能显示“未知发布者”；这不影响 Tauri updater 对下载产物做密码学签名校验。

## 桌面产物

`desktop-release.yml` 产物：

| 平台        | Runner           | 产物                                                                                                                         |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Windows x64 | `windows-latest` | `Calen-vX.Y.Z-Windows-x64.msi`、`Calen-vX.Y.Z-Windows-x64-Setup.exe`、各自 `.sig`，以及只包含 Windows 平台的 `latest.json`。 |

发布 job 会在上传 Windows 产物后生成并上传 Windows-only `latest.json`。桌面端「设置 -> 关于」会根据用户是否允许预发布，从 GitHub Releases 中筛选带 `latest.json` 的正式 / 预发布版本；未允许预发布时只检查正式 Release。首版不发布 portable、Linux 或 macOS 桌面包。

Windows 构建在上传产物前必须运行 `scripts/release/test-windows-installers.ps1`：

- NSIS 静默安装到包含中文和空格的临时目录；
- MSI 尝试相同的自定义目录，不支持时从 Windows Installer 注册信息验证实际默认目录；
- 清空 `PATH`，直接使用安装目录内的 `stock-sidecar/node.exe` 调用 JSON-RPC `status`；
- 静默卸载后确认 sidecar 进程退出、安装目录不再被锁定并可删除；
- 若 GitHub Releases 中存在低于当前版本的上一正式 MSI，则执行旧版安装、当前版升级、sidecar smoke 和卸载；首个版本没有上一 MSI 时会输出明确的 skip notice。

该脚本发现安装、升级、资源路径、内置 Node 或卸载生命周期错误时会直接阻断 Release。它只在 Provider 条款和 updater 签名门禁均满足后运行，因此普通 PR CI 不能替代真实安装验收。

## 桌面版本号来源

本地开发和普通本机构建只维护一个默认版本源：`crates/agent-gui/package.json`。Tauri 默认配置、前端 About 页和 Rust 运行时代码都会从这里读取版本，因此日常开发不需要到多个文件里同步版本号。

正式发布时不依赖人工修改 `package.json`。`desktop-release.yml` 会先在 `Release Metadata` job 中解析 release tag：

```bash
node scripts/release/prepare-app-version-from-tag.mjs vX.Y.Z
```

这个脚本会校验 tag 必须是 `v` 开头的 semver，输出：

| 输出                             | 示例                                          | 用途                                        |
| -------------------------------- | --------------------------------------------- | ------------------------------------------- |
| `LIVEAGENT_RELEASE_TAG`          | `v0.1.3`                                      | GitHub Release、产物命名和下载 URL。        |
| `LIVEAGENT_APP_VERSION`          | `0.1.3`                                       | 前端 About 页和 Rust 运行时代码。           |
| `LIVEAGENT_IS_PRERELEASE`        | `false`                                       | 决定 GitHub Release 是否标记为 prerelease。 |
| `LIVEAGENT_TAURI_VERSION_CONFIG` | `src-tauri/tauri.version.generated.conf.json` | Tauri 构建时追加的临时 config overlay。     |

各平台构建 job 会复用同一份 metadata，并生成一个未提交到仓库的 Tauri overlay：

```json
{
  "version": "0.1.3"
}
```

Tauri 构建命令通过额外的 `--config "$LIVEAGENT_TAURI_VERSION_CONFIG"` 注入这个版本；Vite 和 Rust build script 通过 `LIVEAGENT_APP_VERSION` 注入同一个版本。这样发布版本以 tag 为事实来源，updater manifest、应用内显示版本和安装包版本会保持一致；忘记改 `package.json` 不会导致发布包仍显示旧版本。

Windows 当前没有代码签名 secret，release workflow 会先自动发布 unsigned 包。接入 Windows `.p12/.pfx` 或 Trusted Signing 后再补签名步骤。
