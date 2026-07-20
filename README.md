# Dataset Annotation Studio

一个本地优先的桌面图像数据集标注工作台。它把用户选择的文件夹直接视为可携带项目：图片仍按用户自己的多级目录组织，当前标注保存为图片旁的同名 `.txt`，任务状态、历史、恢复文件与校验结果跟随项目一起移动。

当前版本已经具备一条完整的首期工作流：

- 递归或仅当前层扫描 PNG、JPG/JPEG、WebP
- 缩略图浏览、筛选、批量选择与中央大图预览
- 同名 JSON 字段选择、User Prompt 拼接、下一次请求预览与单图实际请求/推理/最终输出追踪
- 全局 System Prompt、翻译 Prompt 与支持多模型和默认模型的供应商连接预设；标注、翻译任务可按次切换模型
- OpenRouter、OpenAI 兼容接口、OpenCode Go 专用协议、Gemini 原生接口，以及复用 ChatGPT OAuth 的 Codex 适配层
- 持久化批量任务、并发、停止、断点续跑、失败重试和人工采用
- 模型原始响应直接写入同名 `.txt`，并保留每次脱敏请求快照与供应商响应
- 标签闭合轻量校验、异常优先查看、显式编辑保存和标注历史
- 有界多线程最长边缩放，支持 Lanczos 3、Lanczos 4 与二次元低光晕自适应模式，并提供 WebP/JPEG/PNG 转换、模板化批量重命名、执行前预览、项目内原图恢复和逆序撤销
- 导出整个项目或工作台所选图片：原生目录选择、导出前标注校验、警告确认后强制导出，以及可停止和继续的持久化进度；最终目录只含扁平放置的原图与活动同名 `.txt`
- Tauri 桌面窗口；发行构建会把 Python API 与 Worker 打包为本地 sidecar

## 仓库结构

```text
backend/        Python 业务内核、FastAPI、本地任务 Worker
frontend/       React + TypeScript 界面
src-tauri/      Tauri 桌面壳与发行配置
scripts/        构建辅助脚本
docs/           架构、工作区格式与设计决策
assets/         项目级视觉源文件
```

模块边界与扩展规则见 [架构说明](docs/architecture.md)，项目内部文件格式见 [工作区格式](docs/workspace-layout.md)。

## 开发

需要 Node.js、pnpm、Python 3.11+、uv、Rust 与 PowerShell 7。

```powershell
pnpm install
uv sync --project backend --all-groups
pnpm dev
```

`pnpm dev` 会同时启动 Vite、仅监听 `127.0.0.1` 的本地 API、任务 Worker 和 Tauri 窗口。关闭开发命令会一起停止这些进程。

Windows 下推荐直接双击仓库根目录的 `启动开发版.vbs`：它会在后台隐藏 PowerShell
窗口，检查并同步依赖，然后启动同一套源码开发环境；关闭 Dataset Studio 后，启动器和
开发服务会一并退出。`启动开发版.bat` 仍作为兼容入口保留，它会立即转交给无控制台的
Windows Script Host，再由后者隐藏启动 PowerShell；因此 BAT 自身只会在双击瞬间短暂
闪过，不会再产生第二个命令窗口。前端修改会热更新，不会生成安装包。

## 检查与发行构建

```powershell
pnpm check
pnpm build
```

`pnpm check` 执行前端类型检查与 ESLint、Python Ruff 和 Pytest。`pnpm build` 先用 PyInstaller 生成当前 Rust target triple 对应的本地服务，再生成 Tauri 安装包；最终用户不需要单独安装 Python 或启动服务。

需要移除 Rust 编译缓存、发行产物、临时冒烟数据与本地日志时，可以运行 `pnpm clean`。该命令会保留 `node_modules` 与 `backend/.venv`，因此清理后仍可直接启动源码版。

## 数据边界

- 应用不会把图片复制到全局素材库，也不会继续依赖最初导入来源。
- `.annotation-workspace/` 是项目的一部分，默认永久保留；移动整个文件夹后重新打开即可识别原项目。
- API Key 不写入项目或 SQLite，而由操作系统凭据存储保存。
- Codex OAuth Token 不由本应用读写，也不会保存到项目或应用数据库；凭据存储与现有登录复用均由官方 Codex Runtime 管理。
- 运行服务默认只监听 `127.0.0.1:8765`，架构允许日后替换传输层，但当前不提供局域网服务入口。
