import type {
  AnnotationProductionConfiguration as ProductionConfiguration,
  AnnotationProductionScopeId,
} from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationProductionScopeProps {
  configuration: ProductionConfiguration;
}

interface ScopeChoice {
  id: AnnotationProductionScopeId;
  code: string;
  title: string;
  detail: string;
  count: number;
  disabled?: boolean;
}

export function AnnotationProductionScope({ configuration }: AnnotationProductionScopeProps) {
  const choices: readonly ScopeChoice[] = [
    {
      id: "all",
      code: "ALL.00",
      title: "全部素材",
      detail: "覆盖当前项目工作目录中的全部有效素材。",
      count: configuration.totalCount,
    },
    {
      id: "selected",
      code: "SEL.01",
      title: "工作台选中项",
      detail: "使用三级页胶片轨道与素材工作台共同维护的选中集合。",
      count: configuration.selectedCount,
    },
    {
      id: "folder",
      code: "DIR.02",
      title: "工作目录子文件夹",
      detail: "选择一个目录分支，并包含该分支下的全部下级目录。",
      count: configuration.scope === "folder" ? configuration.scopeCount : 0,
      disabled: !configuration.folderLoading && configuration.folderOptions.length === 0,
    },
  ];
  const activeChoice = choices.find((choice) => choice.id === configuration.scope) ?? choices[0];

  return (
    <section
      className="dial-archive-production-scope"
      id="annotation-production-console"
      role="tabpanel"
      aria-label="素材处理范围配置"
    >
      <header className="dial-archive-production-scope__identity dial-archive-production-console__identity">
        <div>
          <span>SCOPE CONFIGURATION // MATERIAL ROUTING</span>
          <h3>素材范围装配</h3>
          <p>范围只决定本次生产任务接收哪些素材；生产支路参数在对应节点中独立配置。</p>
        </div>
        <strong aria-hidden="true">SCP</strong>
      </header>

      <div className="dial-archive-production-scope__choices" aria-label="选择素材处理范围">
        {choices.map((choice) => (
          <button
            className={configuration.scope === choice.id ? "is-active" : undefined}
            type="button"
            aria-pressed={configuration.scope === choice.id}
            disabled={configuration.pending || choice.disabled}
            onClick={() => configuration.setScope(choice.id)}
            key={choice.id}
          >
            <span>{choice.code}</span>
            <b>{choice.title}</b>
            <small>{choice.detail}</small>
            <em>{choice.count.toLocaleString()} MATERIAL</em>
          </button>
        ))}
      </div>

      {configuration.scope === "folder" ? (
        <label className="dial-archive-production-scope__folder">
          <span>
            <small>DIRECTORY BRANCH</small>
            <b>素材子文件夹</b>
          </span>
          <span>
            <select
              value={configuration.folderPath}
              aria-label="素材子文件夹"
              disabled={configuration.pending || configuration.folderLoading}
              onChange={(event) => configuration.setFolderPath(event.target.value)}
            >
              {configuration.folderOptions.length === 0 ? (
                <option value="">当前工作目录没有素材子文件夹</option>
              ) : null}
              {configuration.folderOptions.map((folder) => (
                <option value={folder.id} key={folder.id}>
                  {folder.label}
                  {folder.detail ? ` · ${folder.detail}` : ""}
                </option>
              ))}
            </select>
            <i aria-hidden="true">⌄</i>
          </span>
        </label>
      ) : null}

      <div className="dial-archive-production-scope__summary">
        <span>
          <small>ACTIVE SOURCE</small>
          <b>{activeChoice.title}</b>
        </span>
        <strong>{configuration.scopeCount.toLocaleString()}</strong>
        <span>
          <small>SELECTION EVIDENCE</small>
          <b>
            {configuration.scope === "folder"
              ? configuration.folderPath || "NO DIRECTORY"
              : configuration.scope === "selected"
                ? `${configuration.selectedCount.toLocaleString()} CHECKED`
                : "PROJECT ROOT"}
          </b>
        </span>
      </div>
    </section>
  );
}
