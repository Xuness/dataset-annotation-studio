import type {
  AnnotationDossierContent,
  AnnotationDossierReading,
  AnnotationDossierSectionId,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationDossierRegisterProps {
  asset: AnnotationStageAsset;
  dossier: AnnotationDossierContent;
  section: AnnotationDossierSectionId;
  onSelectSection(section: AnnotationDossierSectionId): void;
}

const DOSSIER_SECTIONS: ReadonlyArray<{
  id: AnnotationDossierSectionId;
  code: string;
  title: string;
}> = [
  { id: "channels", code: "01", title: "通道登记" },
  { id: "metadata", code: "02", title: "素材元数据" },
  { id: "revisions", code: "03", title: "修订证据链" },
  { id: "translations", code: "04", title: "翻译变体" },
  { id: "jobs", code: "05", title: "关联生产任务" },
  { id: "provenance", code: "06", title: "生成与请求溯源" },
];

function formatTimestamp(value: string | null): string {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function compactIdentity(value: string | null, fallback = "—"): string {
  if (!value) return fallback;
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function sectionCount(section: AnnotationDossierSectionId, dossier: AnnotationDossierContent) {
  if (section === "channels") return dossier.documents.length;
  if (section === "metadata") return dossier.metadata.fields.length;
  if (section === "revisions") return dossier.revisions.length;
  if (section === "translations") return dossier.translations.length;
  if (section === "jobs") return dossier.jobs.length;
  return dossier.provenanceHistory.length;
}

function DossierSectionHeading({ code, count }: { code: string; count: number }) {
  return (
    <header className="dial-archive-dossier-section__head">
      <span>REG.{code} / CURRENT PAGE</span>
      <i aria-hidden="true" />
      <b>{String(count).padStart(2, "0")} RECORD</b>
    </header>
  );
}

function ProvenanceReading({ reading }: { reading: AnnotationDossierReading }) {
  return (
    <div className={`is-${reading.tone ?? "default"}`}>
      <dt>{reading.label}</dt>
      <dd title={reading.value}>{compactIdentity(reading.value)}</dd>
      {reading.detail ? <small>{reading.detail}</small> : null}
    </div>
  );
}

function DossierSectionBody({
  section,
  dossier,
}: {
  section: AnnotationDossierSectionId;
  dossier: AnnotationDossierContent;
}) {
  if (section === "channels") {
    return dossier.documents.length ? (
      <ol className="dial-archive-dossier-channels">
        {dossier.documents.map((document) => (
          <li className={`is-${document.availability}`} key={document.id}>
            <span>{document.code}</span>
            <div>
              <b>{document.title}</b>
              <small>
                {document.source ?? "来源未记录"} · {formatTimestamp(document.updatedAt)}
              </small>
            </div>
            <output>{document.statusLabel}</output>
            <details>
              <summary>TECHNICAL REGISTER</summary>
              <dl>
                <div>
                  <dt>HEAD</dt>
                  <dd title={document.revisionId ?? undefined}>
                    {compactIdentity(document.revisionId)}
                  </dd>
                </div>
                <div>
                  <dt>REVIEW</dt>
                  <dd>{document.reviewStatus?.toUpperCase() ?? "OPEN"}</dd>
                </div>
              </dl>
              {document.validationMessage ? <p>{document.validationMessage}</p> : null}
            </details>
          </li>
        ))}
      </ol>
    ) : (
      <p className="dial-archive-dossier-empty">当前对象没有已登记的标注通道。</p>
    );
  }

  if (section === "metadata") {
    const metadataState = dossier.metadata.exists
      ? `${dossier.metadata.fields.length} FIELD`
      : "NO SIDECAR";
    return (
      <>
        <div className="dial-archive-dossier-metadata__identity">
          <span>{metadataState}</span>
          <b title={dossier.metadata.path ?? undefined}>
            {dossier.metadata.path ?? "当前素材未发现元数据侧车文件"}
          </b>
        </div>
        {dossier.metadata.error ? (
          <p className="dial-archive-dossier-empty is-error">{dossier.metadata.error}</p>
        ) : dossier.metadata.fields.length ? (
          <dl className="dial-archive-dossier-metadata">
            {dossier.metadata.fields.map((field) => (
              <div key={field.id}>
                <dt>
                  <span>{field.kind}</span>
                  <b>{field.label}</b>
                </dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="dial-archive-dossier-empty">没有可登记的元数据字段。</p>
        )}
        {dossier.metadata.raw ? (
          <details className="dial-archive-dossier-raw">
            <summary>RAW METADATA // 展开原始记录</summary>
            <pre>{dossier.metadata.raw}</pre>
          </details>
        ) : null}
      </>
    );
  }

  if (section === "revisions") {
    return dossier.revisions.length ? (
      <ol className="dial-archive-dossier-timeline">
        {dossier.revisions.map((revision, index) => (
          <li
            className={`${revision.candidate ? "is-candidate" : ""}${revision.tombstone ? " is-tombstone" : ""}`}
            key={`${revision.channel}:${revision.id}`}
          >
            <span>{(index + 1).toString().padStart(2, "0")}</span>
            <header>
              <b>{revision.channelLabel}</b>
              <time dateTime={revision.createdAt}>{formatTimestamp(revision.createdAt)}</time>
            </header>
            <p>{revision.preview}</p>
            <details>
              <summary>REVISION EVIDENCE</summary>
              <dl>
                <div>
                  <dt>SOURCE</dt>
                  <dd>{revision.source}</dd>
                </div>
                <div>
                  <dt>REVISION</dt>
                  <dd title={revision.id}>{compactIdentity(revision.id)}</dd>
                </div>
                <div>
                  <dt>VALIDATION</dt>
                  <dd>{revision.validationStatus.toUpperCase()}</dd>
                </div>
              </dl>
            </details>
          </li>
        ))}
      </ol>
    ) : (
      <p className="dial-archive-dossier-empty">当前对象尚未形成可追溯的修订链。</p>
    );
  }

  if (section === "translations") {
    return dossier.translations.length ? (
      <ol className="dial-archive-dossier-translations">
        {dossier.translations.map((translation) => (
          <li className={`is-${translation.status}`} key={translation.id}>
            <div className="dial-archive-dossier-translations__language">
              <span>LANGUAGE</span>
              <b>{translation.language}</b>
            </div>
            <div>
              <span>
                {translation.sourceKind.toUpperCase()} → {translation.producerKind.toUpperCase()}
              </span>
              <b>{translation.model ?? translation.producer}</b>
              <small>{formatTimestamp(translation.updatedAt)}</small>
            </div>
            <output>{translation.statusLabel}</output>
            <details>
              <summary>ALIGNMENT / QUALITY</summary>
              <p>
                {translation.alignmentStatus.toUpperCase()} ·{" "}
                {translation.qualityStatus.toUpperCase()}
              </p>
              {translation.issue || translation.qualityIssues.length ? (
                <p>
                  {[translation.issue, ...translation.qualityIssues].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </details>
          </li>
        ))}
      </ol>
    ) : (
      <p className="dial-archive-dossier-empty">当前对象没有翻译变体记录。</p>
    );
  }

  if (section === "jobs") {
    if (dossier.jobsLoading) {
      return <p className="dial-archive-dossier-empty">正在读取当前对象的关联生产任务。</p>;
    }
    if (dossier.jobsIssue) {
      return (
        <p className="dial-archive-dossier-empty is-error">
          关联任务暂时不可用；对象档案的其他证据仍可正常查阅。
          <small>ERROR // {dossier.jobsIssue}</small>
        </p>
      );
    }
    return dossier.jobs.length ? (
      <ol className="dial-archive-dossier-jobs">
        {dossier.jobs.map((job, index) => (
          <li className={`is-${job.itemStatus}`} key={`${job.id}:${job.itemId}`}>
            <span>{(index + 1).toString().padStart(2, "0")}</span>
            <header>
              <b>{job.kindLabel}</b>
              <time dateTime={job.updatedAt}>{formatTimestamp(job.updatedAt)}</time>
            </header>
            <output>{job.itemStatusLabel}</output>
            <button type="button" onClick={() => dossier.openJob(job.id)}>
              打开生产路由场 →
            </button>
            <details>
              <summary>JOB REGISTER</summary>
              <dl>
                <div>
                  <dt>JOB</dt>
                  <dd title={job.id}>{compactIdentity(job.id)}</dd>
                </div>
                <div>
                  <dt>PROFILE</dt>
                  <dd>{job.executionProfile}</dd>
                </div>
                <div>
                  <dt>MODEL</dt>
                  <dd>{job.model}</dd>
                </div>
              </dl>
              {job.error ? <p>{job.error}</p> : null}
            </details>
          </li>
        ))}
      </ol>
    ) : (
      <p className="dial-archive-dossier-empty">当前对象没有关联的自动生产任务。</p>
    );
  }

  if (dossier.provenanceLoading) {
    return <p className="dial-archive-dossier-empty">正在读取当前对象的生成与请求溯源。</p>;
  }
  if (dossier.provenanceIssue) {
    return (
      <p className="dial-archive-dossier-empty is-error">
        生成溯源暂时不可用；已登记的通道、元数据与修订链不受影响。
        <small>ERROR // {dossier.provenanceIssue}</small>
      </p>
    );
  }
  return dossier.provenance ? (
    <div className="dial-archive-dossier-provenance">
      <section
        className={`dial-archive-dossier-provenance__focus ${dossier.provenance.current ? "is-current" : "is-stale"}`}
        data-trace-code={dossier.provenance.code}
      >
        <header>
          <span>{dossier.provenance.code} / SELECTED TRACE</span>
          <b>{dossier.provenance.title}</b>
          <small>{dossier.provenance.model}</small>
          <output>
            {dossier.provenance.current ? "MATCHES CURRENT HEAD" : "HISTORICAL RESPONSE"}
          </output>
        </header>
        <dl>
          {dossier.provenance.readings
            .filter((reading) =>
              ["channel", "provider", "started", "finished", "tokens"].includes(reading.id),
            )
            .map((reading) => (
              <ProvenanceReading reading={reading} key={reading.id} />
            ))}
        </dl>
      </section>

      <div className="dial-archive-dossier-provenance__history-head">
        <span>CALL INDEX / 生成调用历史</span>
        <b>{dossier.provenanceHistory.length} TRACE</b>
      </div>
      <nav className="dial-archive-dossier-provenance__history" aria-label="生成调用历史">
        {dossier.provenanceHistory.map((record, index) => (
          <button
            className={`${record.id === dossier.selectedProvenanceId ? "is-active" : ""}${record.current ? " is-current" : ""}`}
            type="button"
            aria-pressed={record.id === dossier.selectedProvenanceId}
            onClick={() => dossier.selectProvenance(record.id)}
            key={record.id}
          >
            <span>
              {record.code}.{(index + 1).toString().padStart(2, "0")}
            </span>
            <div>
              <b>{record.title}</b>
              <small>{record.model}</small>
            </div>
            <time dateTime={record.startedAt}>{formatTimestamp(record.startedAt)}</time>
            <output>{record.current ? "CURRENT HEAD" : "HISTORICAL"}</output>
          </button>
        ))}
      </nav>

      <details className="dial-archive-dossier-provenance__technical">
        <summary>TECHNICAL IDENTITY // 技术标识</summary>
        <dl>
          {dossier.provenance.readings
            .filter((reading) =>
              ["started", "finished", "job", "item", "attempt", "model"].includes(reading.id),
            )
            .map((reading) => (
              <ProvenanceReading reading={reading} key={reading.id} />
            ))}
        </dl>
      </details>

      <div className="dial-archive-dossier-provenance__raw">
        <details className="dial-archive-dossier-raw">
          <summary>REQUEST ENVELOPE // 请求证据</summary>
          <pre>{dossier.provenance.requestJson}</pre>
        </details>
        <details className="dial-archive-dossier-raw">
          <summary>RESPONSE ENVELOPE // 响应证据</summary>
          <pre>{dossier.provenance.responseJson}</pre>
        </details>
      </div>
    </div>
  ) : (
    <p className="dial-archive-dossier-empty">
      当前对象没有可关联的自动生产请求；手动记录不会伪造生成溯源。
    </p>
  );
}

export function AnnotationDossierRegister({
  asset,
  dossier,
  section,
  onSelectSection,
}: AnnotationDossierRegisterProps) {
  const active = DOSSIER_SECTIONS.find((item) => item.id === section) ?? DOSSIER_SECTIONS[0];
  const count = sectionCount(active.id, dossier);

  return (
    <article className="dial-archive-dossier-register" aria-labelledby="dossier-register-title">
      <header className="dial-archive-dossier-register__title">
        <div>
          <span>MATERIAL DOSSIER / CURRENT OBJECT</span>
          <h2 id="dossier-register-title">{active.title}</h2>
        </div>
        <b aria-hidden="true">{active.code}</b>
        <dl>
          <div>
            <dt>OBJECT</dt>
            <dd title={asset.id}>{compactIdentity(asset.id)}</dd>
          </div>
          <div>
            <dt>REGISTER</dt>
            <dd>{String(count).padStart(2, "0")}</dd>
          </div>
        </dl>
      </header>

      <div className="dial-archive-dossier-register__body">
        <nav className="dial-archive-dossier-register__rail" aria-label="对象档案章节">
          {DOSSIER_SECTIONS.map((item) => (
            <button
              className={item.id === active.id ? "is-active" : undefined}
              type="button"
              aria-pressed={item.id === active.id}
              onClick={() => onSelectSection(item.id)}
              key={item.id}
            >
              <span>{item.code}</span>
              <b>{item.title}</b>
              <small>{String(sectionCount(item.id, dossier)).padStart(2, "0")}</small>
            </button>
          ))}
        </nav>

        <section className={`dial-archive-dossier-section is-${active.id}`}>
          <DossierSectionHeading code={active.code} count={count} />
          <DossierSectionBody section={active.id} dossier={dossier} />
        </section>
      </div>

      <footer className="dial-archive-dossier-register__foot">
        <div className="dial-archive-dossier-register__crosslinks" aria-label="跨空间关联入口">
          <button type="button" onClick={dossier.openArchive}>
            项目档案 / ARCHIVE
          </button>
          <button type="button" onClick={dossier.openQuality}>
            质控审阅 / QUALITY
          </button>
        </div>
        <b>{asset.relativePath}</b>
      </footer>
    </article>
  );
}
