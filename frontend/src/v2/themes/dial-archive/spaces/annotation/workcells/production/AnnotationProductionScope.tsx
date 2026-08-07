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
      detail: "选择一个或多个目录分支，并合并其中的全部下级目录。",
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
        <section className="dial-archive-production-scope__folder" aria-label="素材子文件夹">
          <header>
            <span>
              <small>DIRECTORY SET</small>
              <b>素材目录集合</b>
            </span>
            <span>
              已选 <b>{configuration.folderPaths.length.toLocaleString()}</b>
              <button
                type="button"
                disabled={configuration.pending || configuration.folderPaths.length === 0}
                onClick={configuration.clearFolderPaths}
              >
                清空
              </button>
            </span>
          </header>
          <div role="group" aria-label="选择生产素材目录">
            {configuration.folderOptions.map((folder) => {
              const selected = configuration.folderPaths.includes(folder.id);
              return (
                <button
                  className={selected ? "is-active" : undefined}
                  type="button"
                  aria-label={`切换生产素材目录 ${folder.id}`}
                  aria-pressed={selected}
                  disabled={configuration.pending || configuration.folderLoading}
                  onClick={() => configuration.toggleFolderPath(folder.id)}
                  key={folder.id}
                >
                  <span>
                    <b>{folder.label}</b>
                    <small>{folder.detail}</small>
                  </span>
                  <strong>{selected ? "ON" : "+"}</strong>
                </button>
              );
            })}
            {configuration.folderOptions.length === 0 ? (
              <p>当前工作目录没有素材子文件夹。</p>
            ) : null}
          </div>
        </section>
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
              ? configuration.folderPaths.length
                ? `${configuration.folderPaths.length.toLocaleString()} DIRECTORIES`
                : "NO DIRECTORY"
              : configuration.scope === "selected"
                ? `${configuration.selectedCount.toLocaleString()} CHECKED`
                : "PROJECT ROOT"}
          </b>
        </span>
      </div>
    </section>
  );
}
