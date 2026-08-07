import { useEffect, useMemo, useState } from "react";

import type {
  CapabilityCategoryContent,
  CapabilityLibraryInventoryItem,
} from "../../../../pages/spaces/spacePageModel";

interface CapabilityCategoryPageProps {
  content: CapabilityCategoryContent;
}

type ResourceFilter = "all" | CapabilityLibraryInventoryItem["state"];

const FILTERS: readonly { id: ResourceFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "ready", label: "在线" },
  { id: "attention", label: "待检查" },
];

function fact(resource: CapabilityLibraryInventoryItem, id: string): string {
  const value = resource.facts.find((item) => item.id === id);
  return value ? `${value.value}${value.unit ? ` ${value.unit}` : ""}` : "—";
}

function workspaceTitle(content: CapabilityCategoryContent): string {
  if (content.category.id === "providers") return "模型连接管理台";
  if (content.category.id === "taggers") return "本地打标配置台";
  if (content.category.id === "dictionaries") return "Tag 词典编排台";
  return "Prompt 协议文档库";
}

function DomainHeader({ content }: CapabilityCategoryPageProps) {
  return (
    <header className="dial-archive-capability-domain__header">
      <button
        className="dial-archive-capability-domain__back"
        type="button"
        onClick={content.returnOverview}
      >
        <span aria-hidden="true">←</span>
        <small>SPACE 06</small>
        <strong>返回能力库</strong>
      </button>

      <div className="dial-archive-capability-domain__identity">
        <span>
          CAPABILITY DOMAIN // {content.category.index} // {content.category.englishLabel}
        </span>
        <h1 id="capability-category-page-title">{workspaceTitle(content)}</h1>
        <p>{content.category.description}</p>
      </div>

      <b
        className="dial-archive-capability-domain__code"
        data-code={content.category.code}
        aria-hidden="true"
      >
        {content.category.code}
      </b>

      <nav className="dial-archive-capability-domain__switcher" aria-label="能力领域切换">
        {content.categories.map((category) => (
          <button
            className={category.id === content.category.id ? "is-active" : undefined}
            type="button"
            key={category.id}
            data-lane={category.lane}
            aria-current={category.id === content.category.id ? "page" : undefined}
            aria-label={`进入 ${category.code} ${category.label}工作面`}
            onClick={() => content.selectCategory(category.id)}
          >
            <span>{category.index}</span>
            <strong>{category.code}</strong>
            <small>{category.label}</small>
          </button>
        ))}
      </nav>
    </header>
  );
}

function FunctionRail({ content }: CapabilityCategoryPageProps) {
  return (
    <nav className="dial-archive-capability-domain__functions" aria-label="领域功能分区">
      <span>FUNCTION LANE //</span>
      {content.groups.map((group) => (
        <button
          className={group.id === content.activeGroupId ? "is-active" : undefined}
          type="button"
          key={group.id}
          aria-current={group.id === content.activeGroupId ? "page" : undefined}
          onClick={() => content.selectGroup(group.id)}
        >
          <b>{group.code}</b>
          <strong>{group.label}</strong>
          <small>{String(group.count).padStart(2, "0")}</small>
        </button>
      ))}
      <p>{content.activeGroup.description}</p>
    </nav>
  );
}

function WorkspaceToolbar({
  content,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  resultCount,
}: CapabilityCategoryPageProps & {
  query: string;
  filter: ResourceFilter;
  onQueryChange(value: string): void;
  onFilterChange(value: ResourceFilter): void;
  resultCount: number;
}) {
  return (
    <div className="dial-archive-capability-domain__toolbar">
      <label>
        <span>SEARCH</span>
        <input
          type="search"
          value={query}
          placeholder={`搜索${content.activeGroup.label}`}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <div aria-label="资源状态筛选">
        {FILTERS.map((item) => (
          <button
            className={filter === item.id ? "is-active" : undefined}
            type="button"
            key={item.id}
            aria-pressed={filter === item.id}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <span>
        MATCHED <b>{String(resultCount).padStart(2, "0")}</b>
      </span>
      {content.createResourceLabel ? (
        <button className="is-create" type="button" onClick={content.createResource}>
          ＋ {content.createResourceLabel}
        </button>
      ) : null}
    </div>
  );
}

function EmptyWorkspace({ content }: CapabilityCategoryPageProps) {
  return (
    <div className="dial-archive-capability-domain__empty" role="status">
      <span>{content.activeGroup.code} // EMPTY REGISTER</span>
      <strong>当前分区没有匹配资源</strong>
      <p>调整搜索或状态筛选；需要新增或导入时使用当前领域提供的明确入口。</p>
    </div>
  );
}

function ProviderWorkspace({
  content,
  resources,
}: CapabilityCategoryPageProps & {
  resources: readonly CapabilityLibraryInventoryItem[];
}) {
  const selected = content.activeResource;
  return (
    <div className="dial-archive-provider-console">
      <aside className="dial-archive-provider-console__directory" aria-label="供应商连接目录">
        <header>
          <span>CONNECTION DIRECTORY //</span>
          <b>{String(content.resources.length).padStart(2, "0")}</b>
        </header>
        {resources.length ? (
          <ol>
            {resources.map((resource, index) => (
              <li key={resource.id} data-state={resource.state}>
                <button
                  className={resource.id === content.activeResourceId ? "is-active" : undefined}
                  type="button"
                  aria-current={resource.id === content.activeResourceId ? "true" : undefined}
                  onClick={() => content.selectResource(resource.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <small>{resource.detail}</small>
                    <strong>{resource.label}</strong>
                    <em>{fact(resource, "models")} MODELS</em>
                  </div>
                  <i aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyWorkspace content={content} />
        )}
      </aside>

      <main className="dial-archive-provider-console__board">
        <header data-state={selected?.state ?? "attention"}>
          <div>
            <span>{selected?.kindLabel ?? "PROVIDER GATEWAY"}</span>
            <h2>{selected?.label ?? "尚未登记 API 供应商"}</h2>
            <p>{selected?.summary ?? "使用左侧入口登记第一个模型服务连接。"}</p>
          </div>
          <b>{selected?.state === "ready" ? "ONLINE" : "CHECK"}</b>
        </header>

        {selected ? (
          <>
            <dl className="dial-archive-provider-console__facts">
              {selected.facts.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>
                    {item.value}
                    {item.unit ? <small>{item.unit}</small> : null}
                  </dd>
                </div>
              ))}
            </dl>
            <section className="dial-archive-provider-console__models">
              <header>
                <span>MODEL ROUTES //</span>
                <strong>{fact(selected, "default")}</strong>
              </header>
              <div>
                {selected.tags.length ? (
                  selected.tags.map((tag, index) => (
                    <article className={index === 0 ? "is-primary" : undefined} key={tag}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{tag}</strong>
                      <small>{tag === fact(selected, "default") ? "DEFAULT ROUTE" : "MODEL"}</small>
                    </article>
                  ))
                ) : (
                  <p>NO MODEL ROUTE REGISTERED</p>
                )}
              </div>
            </section>
            <footer>
              <button type="button" onClick={content.openActiveResource}>
                <span>{selected.actionLabel}</span>
                <small>OPEN OBJECT EDITOR</small>
                <i aria-hidden="true">↗</i>
              </button>
              <button type="button" onClick={content.refresh}>
                刷新连接索引 <i aria-hidden="true">↻</i>
              </button>
            </footer>
          </>
        ) : (
          <div className="dial-archive-provider-console__standby">
            <b>PVD</b>
            <span>CONNECTION REGISTER STANDBY</span>
          </div>
        )}
      </main>
    </div>
  );
}

function TaggerProfileMatrix({
  content,
  resources,
}: CapabilityCategoryPageProps & {
  resources: readonly CapabilityLibraryInventoryItem[];
}) {
  if (!resources.length) return <EmptyWorkspace content={content} />;
  return (
    <section className="dial-archive-tagger-matrix" aria-label="Tagger Profile 参数矩阵">
      <header>
        <span>PROFILE</span>
        <span>MODEL</span>
        <span>SELECTION</span>
        <span>THRESHOLD</span>
        <span>CATEGORIES</span>
        <span>DEVICE</span>
        <span>BATCH</span>
        <span>ACTION</span>
      </header>
      {resources.map((resource, index) => (
        <article key={resource.id} data-state={resource.state}>
          <div>
            <small>
              {String(index + 1).padStart(2, "0")} // {resource.kindLabel}
            </small>
            <strong>{resource.label}</strong>
          </div>
          <span>{fact(resource, "model")}</span>
          <span>{fact(resource, "selection")}</span>
          <b>{fact(resource, "threshold")}</b>
          <span>{fact(resource, "categories")}</span>
          <span>{fact(resource, "device")}</span>
          <span>{fact(resource, "batch")}</span>
          <button type="button" onClick={() => content.openResource(resource.id)}>
            编辑配置 ↗
          </button>
        </article>
      ))}
    </section>
  );
}

function TaggerInstallationRack({
  content,
  resources,
}: CapabilityCategoryPageProps & {
  resources: readonly CapabilityLibraryInventoryItem[];
}) {
  if (!resources.length) return <EmptyWorkspace content={content} />;
  return (
    <section className="dial-archive-tagger-rack" aria-label="Tagger 模型安装档案">
      {resources.map((resource, index) => (
        <article key={resource.id} data-state={resource.state}>
          <header>
            <span>MDL-{String(index + 1).padStart(2, "0")}</span>
            <b>{resource.state === "ready" ? "READY" : "CHECK"}</b>
          </header>
          <div>
            <small>{resource.kindLabel}</small>
            <h2>{resource.label}</h2>
            <p>{resource.detail}</p>
          </div>
          <dl>
            {resource.facts.slice(0, 5).map((item) => (
              <div key={item.id}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={() => content.openResource(resource.id)}>
            检查安装档案 <span aria-hidden="true">↗</span>
          </button>
        </article>
      ))}
    </section>
  );
}

function DictionaryStack({
  content,
  resources,
}: CapabilityCategoryPageProps & {
  resources: readonly CapabilityLibraryInventoryItem[];
}) {
  if (!resources.length) return <EmptyWorkspace content={content} />;
  return (
    <section className="dial-archive-dictionary-stack" aria-label="词典优先级堆栈">
      <header>
        <div>
          <span>RESOLUTION ORDER //</span>
          <h2>从上到下解析 Tag 翻译</h2>
        </div>
        <b>{String(resources.length).padStart(2, "0")}</b>
      </header>
      <ol>
        {resources.map((resource, index) => (
          <li key={resource.id} data-state={resource.state}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <div>
              <small>{resource.detail}</small>
              <strong>{resource.label}</strong>
              <p>{resource.summary}</p>
            </div>
            <dl>
              {resource.facts.slice(0, 5).map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => content.openResource(resource.id)}>
              管理词典 ↗
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PromptLibrary({
  content,
  resources,
}: CapabilityCategoryPageProps & {
  resources: readonly CapabilityLibraryInventoryItem[];
}) {
  const selected = content.activeResource;
  return (
    <div className="dial-archive-prompt-library">
      <aside aria-label="Prompt 文档目录">
        <header>
          <span>DOCUMENT INDEX //</span>
          <b>{String(resources.length).padStart(2, "0")}</b>
        </header>
        {resources.length ? (
          resources.map((resource, index) => (
            <button
              className={resource.id === content.activeResourceId ? "is-active" : undefined}
              type="button"
              key={resource.id}
              onClick={() => content.selectResource(resource.id)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <small>{resource.detail}</small>
                <strong>{resource.label}</strong>
                <em>{fact(resource, "length")}</em>
              </div>
            </button>
          ))
        ) : (
          <EmptyWorkspace content={content} />
        )}
      </aside>
      <main>
        <span>{selected?.kindLabel ?? "PROTOCOL DOCUMENT"}</span>
        <h2>{selected?.label ?? "尚未登记协议文档"}</h2>
        <p>{selected?.summary ?? content.activeGroup.description}</p>
        {selected ? (
          <>
            <dl>
              {selected.facts.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>
                    {item.value} {item.unit}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="dial-archive-prompt-library__seal">
              <b>{content.activeGroup.code}</b>
              <span>CONTROLLED DOCUMENT</span>
              <small>正文只在对象编辑器中展开</small>
            </div>
            <button type="button" onClick={content.openActiveResource}>
              {selected.actionLabel} <span aria-hidden="true">↗</span>
            </button>
          </>
        ) : null}
      </main>
    </div>
  );
}

function DomainWorkspace({
  content,
  resources,
}: CapabilityCategoryPageProps & {
  resources: readonly CapabilityLibraryInventoryItem[];
}) {
  if (content.category.id === "providers") {
    return <ProviderWorkspace content={content} resources={resources} />;
  }
  if (content.category.id === "taggers" && content.activeGroupId === "profiles") {
    return <TaggerProfileMatrix content={content} resources={resources} />;
  }
  if (content.category.id === "taggers" && content.activeGroupId === "installations") {
    return <TaggerInstallationRack content={content} resources={resources} />;
  }
  if (content.category.id === "dictionaries") {
    return <DictionaryStack content={content} resources={resources} />;
  }
  return <PromptLibrary content={content} resources={resources} />;
}

export function CapabilityCategoryPage({ content }: CapabilityCategoryPageProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ResourceFilter>("all");

  useEffect(() => {
    setQuery("");
    setFilter("all");
  }, [content.activeGroupId]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleResources = useMemo(
    () =>
      content.resources.filter((resource) => {
        if (filter !== "all" && resource.state !== filter) return false;
        if (!normalizedQuery) return true;
        return [
          resource.label,
          resource.detail,
          resource.kindLabel,
          resource.summary,
          ...resource.tags,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      }),
    [content.resources, filter, normalizedQuery],
  );

  return (
    <section
      className="dial-archive-capability-domain"
      data-category={content.category.id}
      data-group={content.activeGroupId}
      data-status={content.status}
      aria-labelledby="capability-category-page-title"
    >
      <div className="dial-archive-capability-domain__grid" aria-hidden="true" />
      <DomainHeader content={content} />
      <FunctionRail content={content} />
      <WorkspaceToolbar
        content={content}
        query={query}
        filter={filter}
        resultCount={visibleResources.length}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
      />
      <main className="dial-archive-capability-domain__workspace">
        <DomainWorkspace content={content} resources={visibleResources} />
      </main>
      <footer className="dial-archive-capability-domain__footer">
        <span>
          {content.category.code}.{content.activeGroup.code} // DOMAIN WORKSPACE
        </span>
        <span>{content.activeGroup.englishLabel.toUpperCase()}</span>
        <span>{String(content.resources.length).padStart(2, "0")} RESOURCES</span>
      </footer>
      {content.status === "loading" ? (
        <div className="dial-archive-capability-domain__live" role="status">
          SYNCING CAPABILITY SOURCES
        </div>
      ) : content.message ? (
        <div className="dial-archive-capability-domain__live is-error" role="status">
          {content.message}
        </div>
      ) : null}
    </section>
  );
}
