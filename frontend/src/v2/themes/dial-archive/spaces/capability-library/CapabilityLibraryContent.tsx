import { useRef, useState, type KeyboardEvent } from "react";

import type {
  CapabilityLibraryCategory,
  CapabilityLibraryCategoryId,
  CapabilityLibraryContent as CapabilityLibraryContentModel,
} from "../../../../pages/spaces/spacePageModel";
import { CapabilityLibraryDiagram } from "./CapabilityLibraryDiagram";

interface CapabilityLibraryContentProps {
  content: CapabilityLibraryContentModel;
}

function CategoryButton({
  category,
  active,
  buttonRef,
  onSelect,
  onKeyDown,
}: {
  category: CapabilityLibraryCategory;
  active: boolean;
  buttonRef(node: HTMLButtonElement | null): void;
  onSelect(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
}) {
  return (
    <button
      ref={buttonRef}
      className={`dial-archive-capability-library-category${active ? " is-active" : ""}`}
      type="button"
      role="tab"
      id={`capability-category-${category.id}`}
      aria-controls={`capability-panel-${category.id}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-lane={category.lane}
      data-state={category.state}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className="dial-archive-capability-library-category__index">{category.index}</span>
      <span className="dial-archive-capability-library-category__code">{category.code}</span>
      <span className="dial-archive-capability-library-category__label">{category.label}</span>
      <i aria-hidden="true" />
    </button>
  );
}

function CapabilityStatusPanel({
  category,
  onEnter,
  onRefresh,
}: {
  category: CapabilityLibraryCategory;
  onEnter(): void;
  onRefresh(): void;
}) {
  return (
    <aside
      className="dial-archive-capability-library-status"
      data-category={category.id}
      aria-label={`${category.label}状态与操作`}
    >
      <div className="dial-archive-capability-library-status__head">
        <div>
          <span>DISTRICT // {category.index}</span>
          <strong>{category.stateLabel}</strong>
        </div>
        <b>{category.code}</b>
      </div>

      <div className="dial-archive-capability-library-status__headline">
        <strong>{category.headlineValue}</strong>
        <span>{category.headlineLabel}</span>
      </div>

      <dl className="dial-archive-capability-library-status__metrics">
        {category.metrics.map((metric) => (
          <div key={metric.id}>
            <dt>{metric.label}</dt>
            <dd>
              {metric.value}
              <small>{metric.unit}</small>
            </dd>
          </div>
        ))}
      </dl>

      <p className="dial-archive-capability-library-status__summary">{category.summary}</p>
      {category.notice ? (
        <p className="dial-archive-capability-library-status__notice">{category.notice}</p>
      ) : null}

      <section
        className="dial-archive-capability-library-status__inventory"
        aria-label="能力库存摘要"
      >
        <header>
          <span>RESOURCE REGISTER //</span>
          <b>{String(category.inventory.length).padStart(2, "0")}</b>
        </header>
        {category.inventory.length > 0 ? (
          <ol>
            {category.inventory.slice(0, 5).map((item, index) => (
              <li key={item.id} data-state={item.state}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
                <i aria-hidden="true" />
              </li>
            ))}
          </ol>
        ) : (
          <div className="dial-archive-capability-library-status__empty">
            NO REGISTERED RESOURCE
          </div>
        )}
      </section>

      <button
        className="dial-archive-capability-library-status__enter"
        type="button"
        onClick={onEnter}
      >
        <span>进入 {category.code} 资源名册</span>
        <small>OPEN REGISTER // LEVEL 03</small>
        <i aria-hidden="true">↗</i>
      </button>

      <button
        className="dial-archive-capability-library-status__refresh"
        type="button"
        onClick={onRefresh}
      >
        <span>刷新能力索引</span>
        <small>SYNC ALL SOURCES</small>
      </button>
    </aside>
  );
}

export function CapabilityLibraryContent({ content }: CapabilityLibraryContentProps) {
  const [activeId, setActiveId] = useState<CapabilityLibraryCategoryId>("providers");
  const buttonRefs = useRef(new Map<CapabilityLibraryCategoryId, HTMLButtonElement>());
  const activeCategory =
    content.categories.find((category) => category.id === activeId) ?? content.categories[0];

  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    categoryId: CapabilityLibraryCategoryId,
  ) => {
    const currentIndex = content.categories.findIndex((category) => category.id === categoryId);
    let targetIndex = currentIndex;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      targetIndex = (currentIndex + 1) % content.categories.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      targetIndex = (currentIndex - 1 + content.categories.length) % content.categories.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = content.categories.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const target = content.categories[targetIndex];
    setActiveId(target.id);
    buttonRefs.current.get(target.id)?.focus();
  };

  return (
    <section
      className="dial-archive-capability-library"
      data-category={activeCategory.id}
      data-status={content.status}
      aria-labelledby="capability-library-title"
    >
      <div className="dial-archive-capability-library__grid" aria-hidden="true" />
      <div className="dial-archive-capability-library__word" aria-hidden="true">
        <b>//CAPA</b>
        <span>BILITY</span>
      </div>
      <header className="dial-archive-capability-library__identity">
        <span>SPACE 06 // CAPABILITY LIBRARY</span>
        <h1 id="capability-library-title">能力库</h1>
        <small>PRODUCTION CAPABILITY REGISTER · R2</small>
      </header>

      <nav
        className="dial-archive-capability-library__categories"
        role="tablist"
        aria-label="能力分类"
        aria-orientation="vertical"
      >
        {content.categories.map((category, index) => (
          <div
            className={category.lane === "system" ? "is-system" : undefined}
            key={category.id}
            role="presentation"
          >
            {category.lane === "system" && index > 0 ? (
              <span className="dial-archive-capability-library__system-divider" aria-hidden="true">
                SYS / STUDIO
              </span>
            ) : null}
            <CategoryButton
              category={category}
              active={category.id === activeCategory.id}
              buttonRef={(node) => {
                if (node) buttonRefs.current.set(category.id, node);
                else buttonRefs.current.delete(category.id);
              }}
              onSelect={() => setActiveId(category.id)}
              onKeyDown={(event) => selectFromKeyboard(event, category.id)}
            />
          </div>
        ))}
      </nav>

      <section
        className="dial-archive-capability-library__focus"
        role="tabpanel"
        id={`capability-panel-${activeCategory.id}`}
        aria-labelledby={`capability-category-${activeCategory.id}`}
        tabIndex={0}
      >
        <header className="dial-archive-capability-library__focus-head">
          <div className="dial-archive-capability-library__focus-code">
            <span>{activeCategory.index}</span>
            <strong>{activeCategory.code}</strong>
          </div>
          <div>
            <span>{activeCategory.englishLabel.toUpperCase()} //</span>
            <h2>{activeCategory.label}</h2>
            <p>{activeCategory.description}</p>
          </div>
        </header>

        <CapabilityLibraryDiagram category={activeCategory} />

        <footer className="dial-archive-capability-library__focus-foot">
          <span>SELECTED DISTRICT // {activeCategory.code}</span>
          <i aria-hidden="true" />
          <span>GLOBAL RESOURCE SCOPE</span>
          <b>{activeCategory.stateLabel}</b>
        </footer>
      </section>

      <CapabilityStatusPanel
        category={activeCategory}
        onEnter={() => content.openCategory(activeCategory.id)}
        onRefresh={content.refresh}
      />

      <footer className="dial-archive-capability-library__footer">
        <span>CAPABILITY REGISTER // 06</span>
        <span>
          <i /> SINGLE CATEGORY FOCUS
        </span>
        <span>THEME.R2</span>
      </footer>

      {content.status === "loading" ? (
        <div className="dial-archive-capability-library__live-status" role="status">
          SYNCING CAPABILITY SOURCES
        </div>
      ) : content.message ? (
        <div className="dial-archive-capability-library__live-status is-error" role="status">
          {content.message}
        </div>
      ) : null}
    </section>
  );
}
