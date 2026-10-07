import type { CharacterAuditContent } from "../../../../pages/spaces/spacePageModel";

interface Props {
  content: CharacterAuditContent;
}

export function CharacterConfiguration({ content: c }: Props) {
  const provider = c.providers.find((item) => item.id === c.form.provider_profile_id);
  return (
    <section className="dial-archive-character-section" data-testid="character-config">
      <header>
        <span>01 / CONFIGURATION</span>
        <h2>锁定角色与素材范围</h2>
      </header>
      <div className="dial-archive-character-fields">
        <label>
          素材范围
          <select
            data-testid="character-scope"
            value={c.form.scope}
            onChange={(event) => {
              const scope = event.target.value;
              if (scope === "all" || scope === "directory" || scope === "selected")
                c.setForm({ ...c.form, scope, directory: scope === "directory" ? "" : null });
            }}
          >
            <option value="all">整个项目</option>
            <option value="directory">指定目录</option>
            <option value="selected">已选素材（{c.checkedCount}）</option>
          </select>
        </label>
        {c.form.scope === "directory" && (
          <label>
            项目相对目录
            <input
              data-testid="character-directory"
              value={c.form.directory ?? ""}
              onChange={(e) => c.setForm({ ...c.form, directory: e.target.value })}
              placeholder="留空表示项目根目录"
            />
          </label>
        )}
        <label>
          审查风格
          <select
            data-testid="character-style"
            value={c.form.style}
            onChange={(e) =>
              c.setForm({ ...c.form, style: e.target.value === "full" ? "full" : "sparse" })
            }
          >
            <option value="sparse">精简核心特征</option>
            <option value="full">完整角色特征</option>
          </select>
        </label>
        <label>
          最低图片出现次数
          <input
            data-testid="character-minimum-count"
            type="number"
            min={1}
            value={c.form.minimum_count}
            onChange={(e) => c.setForm({ ...c.form, minimum_count: Number(e.target.value) })}
          />
        </label>
        <label>
          审查模型连接
          <select
            data-testid="character-provider"
            value={c.form.provider_profile_id}
            onChange={(e) =>
              c.setForm({ ...c.form, provider_profile_id: e.target.value, model_id: "" })
            }
          >
            <option value="">选择已配置的连接</option>
            {c.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          视觉模型
          <select
            data-testid="character-model"
            value={c.form.model_id}
            onChange={(e) => c.setForm({ ...c.form, model_id: e.target.value })}
          >
            <option value="">选择支持图像的模型</option>
            {provider?.models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          每阶段额外重试次数
          <input
            data-testid="character-retry-limit"
            type="number"
            min={0}
            max={5}
            value={c.form.retry_limit}
            onChange={(e) => c.setForm({ ...c.form, retry_limit: Number(e.target.value) })}
          />
        </label>
      </div>
      <p>
        这是角色标签汇总审查，不是逐图识别，每个角色使用一张代表性参考图；最多三次常规请求，重试可能另外产生费用。
      </p>
      <label>
        查找项目内参考图
        <input
          data-testid="character-reference-search"
          value={c.referenceSearch}
          onChange={(e) => c.searchReferences(e.target.value)}
          placeholder="按文件名搜索"
        />
      </label>
      {c.hasMoreReferences && (
        <button
          type="button"
          data-testid="character-more-references"
          onClick={c.loadMoreReferences}
        >
          加载更多参考图
        </button>
      )}
      <div className="dial-archive-character-profiles">
        {c.form.profiles.map((profile, index) => (
          <fieldset key={index} data-testid={`character-profile-${index}`}>
            <legend>CHARACTER {String(index + 1).padStart(2, "0")}</legend>
            <div className="dial-archive-character-fields">
              <label>
                唯一触发词
                <input
                  data-testid={`character-trigger-${index}`}
                  value={profile.trigger}
                  onChange={(e) => c.updateProfile(index, { ...profile, trigger: e.target.value })}
                />
              </label>
              <label>
                参考图
                <select
                  data-testid={`character-reference-${index}`}
                  value={profile.reference_asset_id}
                  onChange={(e) =>
                    c.updateProfile(index, { ...profile, reference_asset_id: e.target.value })
                  }
                >
                  <option value="">选择项目素材</option>
                  {profile.reference_asset_id &&
                    !c.references.some((r) => r.id === profile.reference_asset_id) && (
                      <option value={profile.reference_asset_id}>已选择的参考素材</option>
                    )}
                  {c.references.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                归属依据
                <select
                  data-testid={`character-membership-${index}`}
                  value={profile.membership}
                  onChange={(e) =>
                    c.updateProfile(index, {
                      ...profile,
                      membership: e.target.value === "directory" ? "directory" : "trigger",
                      directory: e.target.value === "directory" ? "" : null,
                    })
                  }
                >
                  <option value="trigger">Tags 包含触发词</option>
                  <option value="directory">明确指定角色目录</option>
                </select>
              </label>
              {profile.membership === "directory" && (
                <label>
                  角色相对目录
                  <input
                    data-testid={`character-folder-${index}`}
                    value={profile.directory ?? ""}
                    onChange={(e) =>
                      c.updateProfile(index, { ...profile, directory: e.target.value })
                    }
                    placeholder="留空表示整个范围"
                  />
                </label>
              )}
              <label>
                人数标签类别
                <select
                  data-testid={`character-subject-${index}`}
                  value={profile.subject}
                  onChange={(e) => {
                    const subject = e.target.value;
                    if (subject === "girl" || subject === "boy" || subject === "unknown")
                      c.updateProfile(index, { ...profile, subject });
                  }}
                >
                  <option value="unknown">未确认，不自动补齐人数</option>
                  <option value="girl">girl</option>
                  <option value="boy">boy</option>
                </select>
              </label>
            </div>
            {c.references.find((r) => r.id === profile.reference_asset_id) && (
              <img
                className="dial-archive-character-reference-thumb"
                src={c.references.find((r) => r.id === profile.reference_asset_id)?.imageUrl}
                alt={`角色 ${index + 1} 参考图`}
              />
            )}
            <button
              type="button"
              data-testid={`character-remove-${index}`}
              disabled={c.form.profiles.length === 1}
              onClick={() => c.removeProfile(index)}
            >
              移除此角色
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        data-testid="character-add-profile"
        disabled={c.form.profiles.length >= 4}
        onClick={c.addProfile}
      >
        添加角色 · {c.form.profiles.length}/4
      </button>
      <h3>语义词表</h3>
      <label>
        已验证的安装
        <select
          data-testid="character-vocabulary"
          value={c.form.vocabulary_id}
          onChange={(e) => c.setForm({ ...c.form, vocabulary_id: e.target.value })}
        >
          <option value="">请先导入完整三份 CSV</option>
          {c.vocabularies.map((v) => (
            <option key={v.id} value={v.id}>
              {v.source_version.slice(0, 12)} · {v.character_count} 角色 / {v.general_count} 标签
            </option>
          ))}
        </select>
      </label>
      <details className="dial-archive-character-import">
        <summary>导入上游语义词表与查看来源</summary>
        <p>
          来源：storyAura/BooruDatasetTagManagerPlus，程序仓库声明 MIT；词条内容还涉及 Danbooru
          等上游来源，不随本项目改用 Apache-2.0，本工具不自动下载。
        </p>
        <p>
          目录需包含 danbooru_character_tags.csv、danbooru_dataset_general.csv 和
          danbooru_tag_near_synonyms.csv，关系用于提示同部位候选，不视为可直接替换的同义词。
        </p>
        <label>
          本地 CSV 目录
          <input
            data-testid="character-vocabulary-directory"
            value={c.vocabularyDirectory}
            onChange={(e) => c.setVocabularyDirectory(e.target.value)}
          />
        </label>
        <label>
          来源版本
          <input
            data-testid="character-vocabulary-version"
            value={c.vocabularyVersion}
            onChange={(e) => c.setVocabularyVersion(e.target.value)}
          />
        </label>
        <label className="dial-archive-character-check">
          <input
            data-testid="character-license"
            type="checkbox"
            checked={c.licenseAcknowledged}
            onChange={(e) => c.setLicenseAcknowledged(e.target.checked)}
          />
          我已阅读来源与授权说明，并主动导入这些文件
        </label>
        <button
          type="button"
          data-testid="character-import-vocabulary"
          disabled={c.busy || !c.licenseAcknowledged}
          onClick={() => void c.importVocabulary()}
        >
          校验并安装
        </button>
      </details>
      <div className="dial-archive-character-actions">
        <button
          type="button"
          data-testid="character-preview-membership"
          disabled={c.busy}
          onClick={() => void c.previewMembership()}
        >
          预览角色归属
        </button>
        <button
          type="button"
          data-testid="character-create"
          disabled={c.busy || !c.form.vocabulary_id}
          onClick={() => void c.create()}
        >
          保存任务配置
        </button>
      </div>
      {c.membership && (
        <p data-testid="character-membership-result">
          共 {c.membership.total} 张 · 角色归属 {c.membership.member_counts.join(" / ")} · 共享{" "}
          {c.membership.shared_count} · 未归属 {c.membership.unattributed_count} · 缺少 Tags{" "}
          {c.membership.missing_tags_count} · 候选结果 {c.membership.candidate_count}
        </p>
      )}
    </section>
  );
}
