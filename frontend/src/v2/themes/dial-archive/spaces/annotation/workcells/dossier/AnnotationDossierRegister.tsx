import type {
  AnnotationDossierContent,
  AnnotationDossierReading,
  AnnotationStageAsset,
} from "../../../../../../pages/spaces/spacePageModel";

interface AnnotationDossierRegisterProps {
  asset: AnnotationStageAsset;
  dossier: AnnotationDossierContent;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function compactIdentity(value: string | null, fallback = "—"): string {
  if (!value) return fallback;
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function DossierSectionHeading({
  code,
  title,
  count,
}: {
  code: string;
  title: string;
  count: number | string;
}) {
  return (
    <header className="dial-archive-dossier-section__head">
      <span>{code}</span>
      <h3>{title}</h3>
      <b>{String(count).padStart(2, "0")}</b>
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

export function AnnotationDossierRegister({ asset, dossier }: AnnotationDossierRegisterProps) {
  const metadataState = dossier.metadata.exists
    ? `${dossier.metadata.fields.length} FIELD`
    : "NO SIDECAR";

  return (
    <article className="dial-archive-dossier-register" aria-labelledby="dossier-register-title">
      <div className="dial-archive-dossier-register__ghost" aria-hidden="true">
        DOSSIER
      </div>

      <header className="dial-archive-dossier-register__title">
        <div>
          <span>RL-DAS / OBJECT EVIDENCE REGISTER</span>
          <h2 id="dossier-register-title">对象档案</h2>
        </div>
        <b aria-hidden="true">03</b>
        <dl>
          <div>
            <dt>OBJECT</dt>
            <dd title={asset.id}>{compactIdentity(asset.id)}</dd>
          </div>
          <div>
            <dt>CHANNEL HEADS</dt>
            <dd>{dossier.documents.length.toString().padStart(2, "0")}</dd>
          </div>
          <div>
            <dt>REVISION EVENTS</dt>
            <dd>{dossier.revisions.length.toString().padStart(2, "0")}</dd>
          </div>
        </dl>
      </header>

      <nav className="dial-archive-dossier-register__rail" aria-label="对象档案章节">
        <a href="#dossier-channel-register">01 通道登记</a>
        <a href="#dossier-metadata">02 元数据</a>
        <a href="#dossier-revisions">03 修订链</a>
        <a href="#dossier-translations">04 翻译</a>
        <a href="#dossier-provenance">05 溯源</a>
      </nav>

      <section className="dial-archive-dossier-section" id="dossier-channel-register">
        <DossierSectionHeading code="REG.01" title="通道登记" count={dossier.documents.length} />
        {dossier.documents.length ? (
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
                <output>{document.statusLabel}</output>
                {document.validationMessage ? <p>{document.validationMessage}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="dial-archive-dossier-empty">当前对象没有已登记的标注通道。</p>
        )}
      </section>

      <section className="dial-archive-dossier-section" id="dossier-metadata">
        <DossierSectionHeading
          code="REG.02"
          title="素材元数据"
          count={dossier.metadata.fields.length}
        />
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
      </section>

      <section className="dial-archive-dossier-section" id="dossier-revisions">
        <DossierSectionHeading code="REG.03" title="修订证据链" count={dossier.revisions.length} />
        {dossier.revisions.length ? (
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
                  {revision.jobItemId ? (
                    <div>
                      <dt>JOB ITEM</dt>
                      <dd title={revision.jobItemId}>{compactIdentity(revision.jobItemId)}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p className="dial-archive-dossier-empty">当前对象尚未形成可追溯的修订链。</p>
        )}
      </section>

      <section className="dial-archive-dossier-section" id="dossier-translations">
        <DossierSectionHeading code="REG.04" title="翻译变体" count={dossier.translations.length} />
        {dossier.translations.length ? (
          <ol className="dial-archive-dossier-translations">
            {dossier.translations.map((translation) => (
              <li className={`is-${translation.status}`} key={translation.id}>
                <div className="dial-archive-dossier-translations__language">
                  <span>LANGUAGE</span>
                  <b>{translation.language}</b>
                </div>
                <div>
                  <span>
                    {translation.sourceKind.toUpperCase()} →{" "}
                    {translation.producerKind.toUpperCase()}
                  </span>
                  <b>{translation.model ?? translation.producer}</b>
                  <small>{translation.provider ?? "本地执行"}</small>
                </div>
                <dl>
                  <div>
                    <dt>ALIGNMENT</dt>
                    <dd>{translation.alignmentStatus.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>QUALITY</dt>
                    <dd>{translation.qualityStatus.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>UPDATED</dt>
                    <dd>{formatTimestamp(translation.updatedAt)}</dd>
                  </div>
                </dl>
                <output>{translation.statusLabel}</output>
                {translation.issue || translation.qualityIssues.length ? (
                  <p>
                    {[translation.issue, ...translation.qualityIssues].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="dial-archive-dossier-empty">当前对象没有翻译变体记录。</p>
        )}
      </section>

      <section className="dial-archive-dossier-section" id="dossier-provenance">
        <DossierSectionHeading
          code="REG.05"
          title="生成与请求溯源"
          count={dossier.provenance ? 1 : 0}
        />
        {dossier.provenance ? (
          <div className="dial-archive-dossier-provenance">
            <header className={dossier.provenance.current ? "is-current" : "is-stale"}>
              <span>TRACE LINK</span>
              <b>{dossier.provenance.source ?? "来源未命名"}</b>
              <output>
                {dossier.provenance.current ? "MATCHES CURRENT HEAD" : "HISTORICAL RESPONSE"}
              </output>
            </header>
            <dl>
              {dossier.provenance.readings.map((reading) => (
                <ProvenanceReading reading={reading} key={reading.id} />
              ))}
            </dl>
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
        )}
      </section>

      <footer className="dial-archive-dossier-register__foot">
        <span>END OF OBJECT REGISTER</span>
        <b>{asset.relativePath}</b>
        <i aria-hidden="true" />
      </footer>
    </article>
  );
}
