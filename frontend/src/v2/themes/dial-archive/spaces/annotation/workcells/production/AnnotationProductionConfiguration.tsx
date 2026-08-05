import type {
  AnnotationProductionConfiguration as ProductionConfiguration,
  AnnotationProductionOption,
} from "../../../../../../pages/spaces/spacePageModel";
import { ANNOTATION_PRODUCTION_LANE_PRESENTATION } from "./model/annotationProductionPresentation";

interface AnnotationProductionConfigurationProps {
  lane: "tags" | "description" | "translation";
  configuration: ProductionConfiguration;
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
    <label className="dial-archive-production-field dial-archive-preparation-inspector__field">
      <span className="dial-archive-production-field__identity">
        <small>{code}</small>
        <b>{label}</b>
      </span>
      <span className="dial-archive-production-field__control">
        <select
          value={value}
          title={options.find((option) => option.id === value)?.label ?? value}
          aria-label={label}
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
}: AnnotationProductionConfigurationProps) {
  const identity = ANNOTATION_PRODUCTION_LANE_PRESENTATION[lane];

  return (
    <section
      className="dial-archive-production-console"
      id="annotation-production-console"
      role="tabpanel"
      aria-label="生产线路配置"
    >
      <header className="dial-archive-production-console__identity">
        <div>
          <span>CONFIGURATION // {identity.englishTitle}</span>
          <h3>生产参数装配</h3>
          <p>选择生产后端与模型参数；范围、上下文与最终请求分别在相邻输入面核对。</p>
        </div>
        <strong aria-hidden="true">{identity.code}</strong>
      </header>
      <div className="dial-archive-production-console__form">
        <fieldset className="dial-archive-production-console__parameters">
          <legend>
            <span>LANE PARAMETERS</span>
            <b>{identity.code}.CFG</b>
          </legend>

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
        </fieldset>
        <p className="dial-archive-production-console__handoff">
          <span>LANE PARAMETERS</span>
          <b>完成支路配置后，由画布中的 COMMIT 节点执行冻结、校验与写入。</b>
        </p>
      </div>
    </section>
  );
}
