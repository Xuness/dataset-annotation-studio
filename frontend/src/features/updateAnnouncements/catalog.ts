export const UPDATE_ANNOUNCEMENT_SECTION_KINDS = [
  "feature",
  "improvement",
  "fix",
  "notice",
] as const;

export type UpdateAnnouncementSectionKind = (typeof UPDATE_ANNOUNCEMENT_SECTION_KINDS)[number];

export interface UpdateAnnouncementSection {
  kind: UpdateAnnouncementSectionKind;
  title: string;
  items: readonly string[];
}

export interface UpdateAnnouncement {
  id: string;
  version: string;
  publishedAt: string;
  title: string;
  summary: string;
  sections: readonly UpdateAnnouncementSection[];
}

export const UPDATE_ANNOUNCEMENTS = [
  {
    id: "2026-07-30-builtin-token-counting",
    version: "0.1.x",
    publishedAt: "2026-07-30",
    title: "内置 Tokenizer 与 Token 计数更新",
    summary:
      "LLM 描述与翻译对照区现在可以按训练目标实时计算 Token，并随源码内置 Krea 2、Anima 与 T5 所需的 Tokenizer。",
    sections: [
      {
        kind: "feature",
        title: "新增",
        items: [
          "LLM 描述编辑器与翻译对照区新增实时 Token 计数，源描述和当前译文会分别显示结果。",
          "新增 Krea 2、Anima 与 T5 三套训练预设：Krea 2 使用 Qwen3-VL-4B，Anima 同时显示 Qwen3-0.6B 与 T5 v1.1 XXL。",
        ],
      },
      {
        kind: "improvement",
        title: "改进",
        items: [
          "Tokenizer 资源直接随源码和桌面应用发布，无需前往设置页下载或维护额外模型。",
          "预设选择与计数采用紧凑的行内布局，并适配编辑器底栏、翻译对照表头和窄窗口。",
        ],
      },
      {
        kind: "notice",
        title: "注意事项",
        items: [
          "各预设按对应训练流程的特殊 Token 与提示词模板规则计算，因此同一段文本在不同预设下的结果可能不同。",
        ],
      },
    ],
  },
  {
    id: "2026-07-29-source-launch-stability",
    version: "0.1.x",
    publishedAt: "2026-07-29",
    title: "源码启动与桌面稳定性更新",
    summary: "源码启动会自动避开已占用的开发端口，Linux 桌面端在前端异常时也能可靠结束关闭流程。",
    sections: [
      {
        kind: "feature",
        title: "新增",
        items: ["启动时检查受支持的本机回环端口范围，并为 Vite 与本地 API 自动选择可用端口。"],
      },
      {
        kind: "improvement",
        title: "改进",
        items: [
          "同一次启动选择的端口会统一传递给前端、后端与 Tauri，避免各进程使用不同地址。",
          "用户显式指定端口时保持严格校验，不会悄悄改用其它端口。",
        ],
      },
      {
        kind: "fix",
        title: "修复",
        items: [
          "修复 Linux 前端无法响应关闭请求时，黑色空窗口可能一直停留且无法关闭的问题。",
          "修复开发端口被占用时，工具箱可能直接启动失败的问题。",
          "修复 Linux 开发版关闭后终端状态未恢复，导致方向键显示控制序列且无法立即再次启动的问题。",
        ],
      },
      {
        kind: "notice",
        title: "注意事项",
        items: [
          "源码更新仍由用户自行执行 git pull；应用不会检查远端版本、下载更新或执行 Git 命令。",
        ],
      },
    ],
  },
  {
    id: "2026-07-28-streaming-zip-export",
    version: "0.1.x",
    publishedAt: "2026-07-28",
    title: "数据集 ZIP 导出更新",
    summary: "导出页现在可以把冻结后的训练集快照直接写入 ZIP，并保持与文件夹导出一致的内容结构。",
    sections: [
      {
        kind: "feature",
        title: "新增",
        items: [
          "新增 ZIP 输出方式，支持现有的多通道 TXT、逐图 JSON 和多语言译文组合。",
          "压缩包采用流式写入和原子发布，不需要先在内存中构造完整归档。",
        ],
      },
      {
        kind: "improvement",
        title: "改进",
        items: [
          "文件夹导出继续要求目标目录为空；ZIP 导出只校验同名压缩包不存在，不会误判所选父目录。",
          "停止或失败的 ZIP 任务会清理私有临时文件，不留下半成品归档。",
        ],
      },
      {
        kind: "fix",
        title: "修复",
        items: [
          "修复 ZIP 模式错误复用文件夹非空校验，导致已有文件的父目录无法作为导出位置的问题。",
        ],
      },
    ],
  },
] satisfies readonly UpdateAnnouncement[];

export const LATEST_UPDATE_ANNOUNCEMENT = UPDATE_ANNOUNCEMENTS[0];
