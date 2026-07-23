# Dataset Annotation Studio

一个本地优先的桌面图像数据集标注工作台，用于整理图片、调用本地 Tagger 或多模态模型、
审阅标注、预处理并导出可训练数据集。

> 当前状态：`0.1.x` 源码预览版。仓库暂不提供安装包或预编译 sidecar；Linux 支持仍处于
> x86_64 桌面环境实验阶段。

## 它能做什么

- 直接把一个可写文件夹作为项目，不强制导入或复制图片。
- 扫描 PNG、JPG/JPEG、WebP、BMP、TIFF，保留多级目录浏览和批量选择。
- 使用本地 ONNX Tagger，或 OpenRouter、OpenAI 兼容接口、OpenCode Go、Gemini、
  Codex 等外部提供方生成标注。
- 保存原始响应、任务快照、失败原因和标注历史，支持停止、继续和失败重试。
- 批量缩放、格式转换、重命名、恢复与撤销，文件写入带预览和冲突检查。
- 校验后导出原图与活动同名 `.txt`，支持整个项目或当前勾选范围。

## 支持范围

| 平台 | 当前状态 | 源码运行方式 |
| --- | --- | --- |
| Windows 10/11 x86_64 | 主要开发平台 | `pnpm dev` 或双击 `启动开发版.vbs` |
| Linux x86_64 | 实验性 | 安装 Tauri 系统依赖后运行 `pnpm dev` |
| macOS / ARM64 | 尚未验证 | 暂不承诺支持 |

源码运行仍会在本机编译 Rust/Tauri 桌面壳，但不会生成或发布安装包。

## 从源码启动

需要以下工具：

- Node.js LTS、Corepack 和 pnpm
- Python 3.11+
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Rust stable
- 当前平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)

克隆仓库并使用默认 CPU Runtime：

```text
git clone https://github.com/Xuness/dataset-annotation-studio.git
cd dataset-annotation-studio
corepack enable
pnpm install --frozen-lockfile
uv sync --project backend --extra cpu --all-groups --locked
pnpm dev
```

首次启动会编译桌面壳，因此会比后续启动慢。Vite、本地 API、任务 Worker 和窗口都附着在
当前终端；结束 `pnpm dev` 会停止整套源码服务。

### Windows 快捷入口

安装好 Node.js、pnpm、uv、Rust 和 PowerShell 7 后，可以双击根目录的
`启动开发版.vbs`。它会检查锁定依赖并在后台启动 CPU 源码环境。`启动开发版.bat`
是兼容入口，会转交给同一个 VBS 启动器。

### 可选 NVIDIA CUDA

CPU 是默认且跨平台的基线。x86_64 NVIDIA 环境可以显式选择 CUDA：

```text
uv sync --project backend --extra cuda --all-groups --locked
pnpm dev:cuda
```

`onnxruntime` 与 `onnxruntime-gpu` 不能在同一环境中并存，uv 配置会阻止同时选择两个
extra。CUDA Runtime 还受 NVIDIA 软件条款约束；本仓库不分发其二进制文件。

如果已有 `.venv` 曾经切换或混装过 CPU/GPU Runtime，先运行
`uv venv --clear backend/.venv`，再执行上面选定的一条 `uv sync` 命令。它只重建项目
虚拟环境，不会删除数据集或应用数据。

Linux 的系统包、XDG 数据目录、Secret Service 和桌面环境注意事项见
[Linux 源码指南](docs/linux.md)。

## 五分钟上手

1. 在首页选择一个**可写**的图片目录。应用会把这个目录直接作为项目。
2. 等待首次扫描完成，在左侧目录树或素材列表中选择图片。
3. 根据需要配置执行方式：
   - 在“设置 → 本地打标器”中下载、导入并配置本地模型；
   - 或在“预设与连接”中配置外部模型提供方和 System Prompt。
4. 在工作台预览本次请求，先用单图确认输出，再创建批量标注或翻译任务。
5. 审阅异常项和标注历史，必要时人工修改并保存。
6. 在导出页选择空目录，检查阻塞错误与警告后开始导出。

模型下载不会递归复制整个仓库，只会拉取适配器声明的固定 revision 和文件，并核对大小
与 SHA-256。下载前必须阅读并确认模型自己的许可证；项目的 Apache-2.0 许可证不覆盖
模型权重。完整清单见[模型许可证说明](docs/model-licenses.md)。

## 数据与隐私

- 当前标注保存在图片旁的同名 `.txt`，不会被改写成项目专用格式。
- `.annotation-workspace/` 保存项目 ID、SQLite 状态、任务历史、恢复文件和运行追踪。
  移动项目时应连同整个目录一起移动。
- 图片预处理和素材删除会修改项目文件，但必须先生成计划，并保留可恢复状态。重要数据仍
  建议先备份。
- API Key 和 Hugging Face 连接秘密通过操作系统凭据库保存，不写入项目 SQLite。
- Codex OAuth 凭据由官方 Codex Runtime 管理，本应用不读取、复制或转发 Token。
- 本地 Tagger 不上传图片。选择外部提供方后，对应图片、Prompt 和所选元数据会发送给该
  提供方；费用、保留策略和使用条款由用户与提供方之间的协议决定。
- 本项目未实现遥测或使用分析。Hugging Face 模型下载和用户主动发起的外部模型请求是
  明确的联网行为。
- 本地 API 默认只监听 `127.0.0.1:8765`，不是局域网或公共服务入口。

Codex 连接面向用户本人、受信任设备上的本地工作流，不应被改造成共享代理、Token 转发
服务或规避服务限制的高并发后端。大规模或商业自动标注应优先使用对应提供方正式开放的
API 与批处理产品。

## 文件位置

全局设置、日志和默认模型库位于：

- Windows：`%LOCALAPPDATA%\DatasetAnnotationStudio`
- Linux：`${XDG_DATA_HOME:-$HOME/.local/share}/DatasetAnnotationStudio`
- macOS：`~/Library/Application Support/DatasetAnnotationStudio`（尚未验证）

可以通过 `DATASET_STUDIO_APP_DATA` 指定绝对路径。项目数据仍位于用户选择的数据集目录，
不会迁入全局应用目录。

## 常见问题

### 本地服务没有响应

确认 `5173` 和 `8765` 端口没有被其它进程占用，并查看“设置 → 关于与诊断”显示的日志
目录。源码终端中的第一条错误通常最有价值。

### Linux 无法保存 Token 或 API Key

确认当前桌面/DBus 会话中存在并已解锁 GNOME Keyring、KWallet 或其它 Freedesktop
Secret Service。应用不会退回到明文凭据文件。Hugging Face 下载仍可使用 `HF_TOKEN`
或本机 `hf auth login` 登录。

### 本地模型只显示 CPU

默认源码环境安装 CPU Runtime。需要 NVIDIA CUDA 时，重新执行 CUDA extra 同步命令并
使用 `pnpm dev:cuda` 启动。

### 数据集打开后无法写入

数据集根目录必须允许创建 `.annotation-workspace/`、同名 `.txt` 和恢复文件。只读挂载、
受限网络共享或没有写权限的目录不能作为完整项目使用。

## 开发与设计文档

- [源码开发与检查](docs/development.md)
- [Linux 源码指南](docs/linux.md)
- [架构与模块边界](docs/architecture.md)
- [工作区文件格式](docs/workspace-layout.md)
- [模型许可证说明](docs/model-licenses.md)
- [贡献指南](CONTRIBUTING.md)
- [安全报告方式](SECURITY.md)
- [变更记录](CHANGELOG.md)

## 许可证

项目代码以及 [ASSETS.md](ASSETS.md) 中列出的项目原创视觉资产，在相应权利存在且由项目
作者持有的范围内，按 [Apache License 2.0](LICENSE) 授权。

依赖库、在线服务、下载模型和用户提供的素材保留各自的许可证、服务条款与权利归属。
