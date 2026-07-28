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
- 在项目 SQLite 中分别管理原有标注、结构化 Tags、LLM 描述和多语言译文，独立保留当前可用性、人工复核状态与完整修订历史。
- 可把 ffdkj、WeiLin Prompt、TagComplete 中文整合包和 licyk CSV 规范化为本地只读
  Tag 词典；用户修正词条独立覆盖原库，无需把 Tags 发送给 LLM。
- 校验通过且匹配当前图片的 Tagger、LLM 和翻译结果可立即用于后续流程；人工复核是可选的质量标记，素材页可按 Tags、LLM 描述、原有标注或具体译文语言批量复核与删除。
- 可在素材页提示词配置中选择把当前可用 Tags 冻结后追加到 LLM User Prompt，并预览实际拼接内容；任务创建后的 Tag 编辑不会改变既有任务。
- 批量缩放、格式转换、重命名、恢复与撤销，文件写入带预览和冲突检查；CUDA
  运行时可按图片能力加速 JPEG 编解码和 Lanczos 缩放。
- 按“通道 + 语言”独立选择当前或已复核修订，支持一次导出多种译文语言的 TXT、逐图 JSON 或两者；结果可写入文件夹或流式封装为 ZIP 压缩包。

## 支持范围

| 平台                 | 当前状态     | 源码运行方式                         |
| -------------------- | ------------ | ------------------------------------ |
| Windows 10/11 x86_64 | 主要开发平台 | 双击 `启动开发版.vbs`                 |
| Linux x86_64         | 实验性       | 安装 Tauri 依赖后运行 `./启动开发版.sh` |
| macOS / ARM64        | 尚未验证     | 暂不承诺支持                         |

源码运行仍会在本机编译 Rust/Tauri 桌面壳，但不会生成或发布安装包。

## 从源码启动

需要以下工具：

- Node.js LTS、Corepack 和 pnpm
- Python 3.11+
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Rust stable
- 当前平台的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)

克隆仓库并启用包管理工具：

```text
git clone https://github.com/Xuness/dataset-annotation-studio.git
cd dataset-annotation-studio
corepack enable
```

启动器默认自动探测运行时：检测到可用的 NVIDIA CUDA 设备时使用
`backend/.venv-cuda`，否则使用 `backend/.venv-cpu`。两套环境独立同步，不会因为启动
另一种模式而卸载或覆盖已有依赖。首次启动会下载依赖并编译桌面壳，因此会比后续启动慢。

### Windows 快捷入口

安装好 Node.js、pnpm、uv、Rust 和 PowerShell 7 后，可以双击根目录的
`启动开发版.vbs`。它会自动选择 CUDA 或 CPU 环境并在后台启动源码服务；
`启动开发版.bat` 是兼容入口。终端中也可以显式覆盖：

```powershell
pwsh -NoProfile -File scripts/start-dev.ps1 -Runtime cuda
pwsh -NoProfile -File scripts/start-dev.ps1 -Runtime cpu
```

### Linux 快捷入口

根目录的 Linux 启动脚本与 Windows 使用相同的运行时策略：

```bash
chmod +x ./启动开发版.sh
./启动开发版.sh
./启动开发版.sh --cuda
./启动开发版.sh --cpu
```

脚本还保留 `--graphics cpu-paint|native|nvidia-sync|dmabuf-off|software`（Linux 默认
`cpu-paint`）、`--check-only` 和 `--skip-sync`。详细系统依赖见
[Linux 源码指南](docs/linux.md)。

### CPU 与 CUDA Runtime

`onnxruntime` 与 `onnxruntime-gpu` 两个发行包不能安全安装到同一个 Python 环境，
因此源码启动器分别维护 `.venv-cpu` 和 `.venv-cuda`。这不代表 CUDA 模式不能使用
CPU：`onnxruntime-gpu` 同时提供 CUDA 和 CPU Execution Provider，图片预处理的
Pillow/OpenCV CPU 路径也始终保留。

CUDA 环境额外安装 CuPy、nvImageCodec 和 nvJPEG，并将 cuDNN 固定在仍支持 Tesla
V100/Volta 的 9.10 系列；CUDA Runtime 受 NVIDIA 软件条款约束，本仓库不分发其
二进制文件。显式请求 CUDA 但设备或运行时探针失败时，启动器会报告错误，不会把 CPU
执行伪装成 CUDA。

预处理页会动态探测设备，并提供“自动选择 / 仅 CPU / 硬件加速”。当前 CUDA 后端对
8 位、非渐进式 JPEG 提供 GPU/混合编解码管线，对 L、LA、RGB、RGBA 图片的
Lanczos 3/4 缩放提供 GPU 路径。PNG、WebP 等格式仍可采用 CPU 解码 + GPU 缩放 +
CPU 编码；多帧、特殊位深、特殊颜色模式、低光晕算法或运行时失败会逐项安全回退 CPU，
不会把回退结果伪装为 GPU 执行。

旧版 `backend/.venv` 不再由快捷启动器使用，可以在确认没有旧进程依赖它后自行删除；
数据集和应用数据不在这些虚拟环境中。

## 五分钟上手

1. 在首页选择一个**可写**的图片目录。应用会把这个目录直接作为项目。
2. 等待首次扫描完成，在左侧目录树或素材列表中选择图片。
3. 根据需要配置执行方式：
   - 在“设置 → 本地打标器”中下载、导入并配置本地模型；
   - 或在“预设与连接”中配置外部模型提供方和 System Prompt。
4. 在工作台预览本次请求，先用单图确认输出，再创建批量标注或翻译任务。
5. 在 Tags、LLM 描述和翻译通道中审阅、修改标注；批量复核或删除前会先选择具体类别，存在旧 TXT 时才会显示“原有标注”，人工复核不影响有效结果继续流转。
6. 在导出页为各通道和译文语言分别选择修订策略、TXT / JSON、文件夹或 ZIP 输出方式和导出目录，检查阻塞错误与过期警告后开始导出；文件夹输出要求目录为空，ZIP 输出只要求同名压缩包不存在。

模型下载不会递归复制整个仓库，只会拉取适配器声明的固定 revision 和文件，并核对大小
与 SHA-256。下载前必须阅读并确认模型自己的许可证；项目的 Apache-2.0 许可证不覆盖
模型权重。完整清单见[模型许可证说明](docs/model-licenses.md)。

## 数据与隐私

- 项目 SQLite 是活动标注的唯一来源；Tagger、LLM 和翻译任务不会在运行时旁路写同名 TXT。
- 首次升级时，已有同名 `.txt` 会导入“原有标注”专属通道并原样保留；之后外部修改不会覆盖数据库。
- `.annotation-workspace/` 保存项目 ID、标注修订、任务历史、恢复文件和运行追踪。
  移动项目时应连同整个目录一起移动。
- 图片预处理和素材删除会修改项目文件，但必须先生成计划，并保留可恢复状态。重要数据仍
  建议先备份。
- API Key 和 Hugging Face 连接秘密通过操作系统凭据库保存，不写入项目 SQLite。
- Codex OAuth 凭据由官方 Codex Runtime 管理，本应用不读取、复制或转发 Token。
- 本地 Tagger 与本地 Tag 词典不上传图片或 Tags。选择外部提供方后，对应图片、Prompt 和所选元数据会发送给该
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

源码启动器会把本地 Tag 词典保存在仓库根目录的 `dictionaries/`，与 `models/` 同级。
该目录包含规范化索引、保留的原始来源、下载断点与安装清单，已从 Git 排除。词典文件及
词条内容继续受各自上游许可证和来源条款约束。

## 常见问题

### 本地服务没有响应

源码启动器会在同步依赖前检查 `5173` 和 `8765`，若被占用则报告进程并停止，不会自动
终止其它程序。释放对应端口后重试，并查看“设置 → 关于与诊断”显示的日志目录；源码
终端中的第一条错误通常最有价值。

### Linux 无法保存 Token 或 API Key

确认当前桌面/DBus 会话中存在并已解锁 GNOME Keyring、KWallet 或其它 Freedesktop
Secret Service。应用不会退回到明文凭据文件。Hugging Face 下载仍可使用 `HF_TOKEN`
或本机 `hf auth login` 登录。

### Linux 或 niri 下窗口偶发黑屏

Linux 使用原生窗口边框，但默认保留与 Windows 相同的主题、壁纸、透光区域和沉浸模式
效果。Linux 启动器默认使用 `cpu-paint` 图形档位：它把 WebKitGTK 的 Skia 瓦片绘制
移到 CPU 线程，规避已在 niri + Mesa radeonsi 上确认的 GPU 绘制线程崩溃（表现为运行
一段时间后黑屏或卡死），同时保留全部加速合成视觉效果。若仍出现黑屏，可按
[Linux 源码指南](docs/linux.md#wayland-and-webkitgtk-graphics-compatibility) 依次尝试
`nvidia-sync`、`dmabuf-off` 或 `software` 图形兼容档位；只有最后的 `software`
档位会关闭高成本模糊与动画。

### 本地模型只显示 CPU

先查看启动日志中的 `Runtime` 与 `Python 环境`。NVIDIA 机器正常应使用
`backend/.venv-cuda`；可运行 `scripts/start-dev.ps1 -Runtime cuda -CheckOnly`
（Linux 使用 `./启动开发版.sh --cuda --check-only`）执行严格探测。

### 数据集打开后无法写入

数据集根目录必须允许创建 `.annotation-workspace/` 和恢复文件；TXT / JSON 只在用户选择的外部导出目录中物化。只读挂载、
受限网络共享或没有写权限的目录不能作为完整项目使用。

## 开发与设计文档

- [源码开发与检查](docs/development.md)
- [Linux 源码指南](docs/linux.md)
- [运行时稳定性修复报告](docs/runtime-stability-fix-report.md)
- [架构与模块边界](docs/architecture.md)
- [工作区文件格式](docs/workspace-layout.md)
- [模型许可证说明](docs/model-licenses.md)
- [本地 Tag 词典来源与授权](docs/dictionary-licenses.md)
- [贡献指南](CONTRIBUTING.md)
- [安全报告方式](SECURITY.md)
- [变更记录](CHANGELOG.md)

## 许可证

项目代码以及 [ASSETS.md](ASSETS.md) 中列出的项目原创视觉资产，在相应权利存在且由项目
作者持有的范围内，按 [Apache License 2.0](LICENSE) 授权。

依赖库、在线服务、下载模型和用户提供的素材保留各自的许可证、服务条款与权利归属。
