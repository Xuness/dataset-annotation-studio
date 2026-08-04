import type {
  AnnotationProductionConfiguration as ProductionConfiguration,
  AnnotationProductionOption,
} from "../../../../../../pages/spaces/spacePageModel";
import {
  ProductionInstrumentHeader,
  ProductionPhaseRail,
} from "./AnnotationProductionInstrumentChrome";
import { ANNOTATION_PRODUCTION_LANE_PRESENTATION } from "./model/annotationProductionPresentation";

interface AnnotationProductionConfigurationProps {
  lane: "tags" | "description" | "translation";
  configuration: ProductionConfiguration;
  message: string | null;
}

interface SelectFieldProps {
  code: string;
  label: string;
  value: string;
  options: readonly AnnotationProductionOption[];
  disabled?: boolean;
  onChange(value: string): void;
}

function SelectField({ code, label, value, options, disabled, onChange }: SelectFieldProps) {
  return (
    <label className="dial-archive-production-field">
      <span className="dial-archive-production-field__identity">
        <small>{code}</small>
        <b>{label}</b>
      </span>
      <span className="dial-archive-production-field__control">
        <select
          value={value}
          disabled={disabled || options.length === 0}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.length === 0 ? <option value="">当前没有可用选项</option> : null}
          {options.map((option) => (
            <option value={option.id} disabled={option.disabled} key={option.id}>
              {option.label}
              {option.detail ? ` · ${option.detail}` : ""}
            </option>
          ))}
        </select>
        <i aria-hidden="true">⌄</i>
      </span>
    </label>
  );
}

export function AnnotationProductionConfiguration({
  lane,
  configuration,
  message,
}: AnnotationProductionConfigurationProps) {
  const identity = ANNOTATION_PRODUCTION_LANE_PRESENTATION[lane];

  return (
    <section
      className="dial-archive-production-console"
      id="annotation-production-console"
      role="tabpanel"
      aria-label="生产线路配置"
    >
      <ProductionInstrumentHeader
        lane={lane}
        register="CONFIGURATION REGISTER"
        title={identity.title}
        detail="参数会在任务建立时冻结为执行快照；下方胶片轨道继续表示当前素材范围。"
      />

      <ProductionPhaseRail active="route" label="任务建立阶段" />

      <form
        className="dial-archive-production-console__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (configuration.ready && !configuration.pending) void configuration.create();
        }}
      >
        <div className="dial-archive-production-console__matrix-head" aria-hidden="true">
          <span>PARAMETER MATRIX</span>
          <i />
          <b>{identity.code}.CFG</b>
        </div>

        {configuration.backendOptions.length > 1 ? (
          <SelectField
            code="EXE.00"
            label="执行方式"
            value={configuration.backend}
            options={configuration.backendOptions}
            onChange={(value) =>
              configuration.setBackend(value as ProductionConfiguration["backend"])
            }
          />
        ) : null}

        {configuration.backend === "local_tagger" ? (
          <SelectField
            code="MOD.01"
            label="本地打标配置"
            value={configuration.taggerProfileId}
            options={configuration.taggerProfileOptions}
            onChange={configuration.setTaggerProfile}
          />
        ) : null}

        {configuration.backend === "provider" ? (
          <>
            <SelectField
              code="PRV.01"
              label="模型连接"
              value={configuration.providerProfileId}
              options={configuration.providerProfileOptions}
              onChange={configuration.setProviderProfile}
            />
            <SelectField
              code="MOD.02"
              label="任务模型"
              value={configuration.modelId}
              options={configuration.modelOptions}
              disabled={!configuration.providerProfileId}
              onChange={configuration.setModel}
            />
          </>
        ) : null}

        {lane === "translation" ? (
          <>
            {configuration.backend === "provider" ? (
              <SelectField
                code="PRM.03"
                label="翻译 Prompt"
                value={configuration.promptPresetId}
                options={configuration.promptPresetOptions}
                onChange={configuration.setPromptPreset}
              />
            ) : null}
            <SelectField
              code="SRC.04"
              label="翻译来源"
              value={configuration.translationSource}
              disabled={configuration.backend === "local_dictionary"}
              options={[
                { id: "description", label: "LLM 描述", detail: "缺失时回退原有标注" },
                { id: "tags", label: "Tags", detail: "逐项对齐" },
              ]}
              onChange={(value) =>
                configuration.setTranslationSource(
                  value as ProductionConfiguration["translationSource"],
                )
              }
            />
            <SelectField
              code="LNG.05"
              label="目标语言"
              value={configuration.targetLanguage}
              options={configuration.targetLanguageOptions}
              disabled={configuration.backend === "local_dictionary"}
              onChange={configuration.setTargetLanguage}
            />
            <SelectField
              code="POL.06"
              label="已有译文策略"
              value={configuration.translationPolicy}
              options={[
                { id: "skip", label: "跳过已有译文" },
                { id: "stale", label: "补齐缺失并重译失效项" },
                { id: "overwrite", label: "覆盖范围内全部译文" },
              ]}
              onChange={(value) =>
                configuration.setTranslationPolicy(
                  value as ProductionConfiguration["translationPolicy"],
                )
              }
            />
          </>
        ) : null}

        <div className="dial-archive-production-snapshot">
          <header>
            <span>FROZEN EXECUTION SNAPSHOT</span>
            <b>LOCKED</b>
          </header>
          <dl>
            {configuration.snapshot.map((field) => (
              <div className={field.tone ? `is-${field.tone}` : undefined} key={field.id}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
                {field.detail ? <small>{field.detail}</small> : null}
              </div>
            ))}
          </dl>
        </div>

        {configuration.blockers.length > 0 ? (
          <div className="dial-archive-production-blockers" role="status">
            <span>INTERLOCK // {configuration.blockers.length.toString().padStart(2, "0")}</span>
            <ul>
              {configuration.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="dial-archive-production-ready" role="status">
            <span>ROUTE VALIDATED</span>
            <b>{configuration.scopeCount.toLocaleString()} MATERIAL READY</b>
          </div>
        )}

        {message ? <p className="dial-archive-production-console__error">{message}</p> : null}

        <button
          className="dial-archive-production-launch"
          type="submit"
          disabled={!configuration.ready || configuration.pending}
        >
          <span>{configuration.pending ? "CREATING OPERATION" : "COMMIT PRODUCTION ROUTE"}</span>
          <b>{configuration.pending ? "正在建立任务" : "建立并启动生产任务"}</b>
          <i aria-hidden="true">→</i>
        </button>
      </form>
    </section>
  );
}
