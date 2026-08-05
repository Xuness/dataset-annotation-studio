import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getHomeSpace } from "../../../navigation/spaceRegistry";
import type {
  AnnotationBatchContent,
  AnnotationDossierContent,
  AnnotationDossierProvenance,
  AnnotationEditContent,
  AnnotationProjectContextContent,
  AnnotationProductionContent,
  AnnotationProductionOperation,
  AnnotationRequestPreviewContent,
  AnnotationStageAsset,
  AnnotationStageContent,
} from "../../../pages/spaces/spacePageModel";
import { DialArchiveSpacePage } from "./DialArchiveSpacePage";

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () =>
      ({
        matches,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  });
}

function stageAsset(id: string, index: number): AnnotationStageAsset {
  return {
    id,
    filename: `${id}.png`,
    relativePath: `images/${id}.png`,
    width: 1024,
    height: 768,
    byteSize: 1_048_576,
    suffix: ".png",
    imageUrl: `/image/${id}`,
    thumbnailUrl: `/thumbnail/${id}`,
    annotationStatus: index % 2 === 0 ? "valid" : "missing",
    channelStatuses: index % 2 === 0 ? { tags: "valid" } : {},
  };
}

function editContent(overrides: Partial<AnnotationEditContent> = {}): AnnotationEditContent {
  return {
    status: "ready",
    message: null,
    channel: "tags",
    channels: [
      {
        id: "existing_annotation",
        code: "TXT.00",
        title: "原有标注",
        shortTitle: "原文",
        state: "missing",
        stateLabel: "尚未建立",
        enabled: false,
      },
      {
        id: "tags",
        code: "TAG.01",
        title: "标签",
        shortTitle: "Tags",
        state: "usable",
        stateLabel: "当前可用",
        enabled: true,
      },
      {
        id: "description",
        code: "DSC.02",
        title: "描述",
        shortTitle: "描述",
        state: "missing",
        stateLabel: "尚未建立",
        enabled: true,
      },
      {
        id: "translation",
        code: "TRN.03",
        title: "译文",
        shortTitle: "译文",
        state: "missing",
        stateLabel: "尚未建立",
        enabled: true,
      },
    ],
    document: {
      displayName: "Tags",
      exists: true,
      availability: "usable",
      availabilityLabel: "当前可用",
      reviewStatus: "unreviewed",
      sourceLabel: "Tagger 生成",
      modifiedAt: "2026-08-04T10:00:00Z",
      validationIssue: null,
    },
    text: "",
    textPlaceholder: "",
    characterCount: 0,
    lineCount: 1,
    tokenProfileId: "krea2",
    tokenProfiles: [{ id: "krea2", label: "Krea 2" }],
    tokenMetrics: [],
    tokenMetricsPending: false,
    tags: {
      groups: [],
      count: 0,
      query: "",
      statusMessage: "",
      vocabularyId: "auto",
      vocabularies: [{ id: "auto", label: "跟随标注来源", detail: "" }],
      suggestions: [],
      suggestionsOpen: false,
      suggestionsPending: false,
      suggestionsError: null,
      activeSuggestion: 0,
      setQuery: vi.fn(),
      setSuggestionsOpen: vi.fn(),
      setActiveSuggestion: vi.fn(),
      setVocabulary: vi.fn(),
      addQuery: vi.fn(),
      addSuggestion: vi.fn(),
      removeTag: vi.fn(),
      handleEmptyBackspace: vi.fn(),
    },
    translation: {
      language: "zh-CN",
      languageOptions: ["zh-CN"],
      sourceKind: "description",
      producerKind: "llm",
      sourceContent: "",
      sourceExists: false,
      status: "missing",
      statusLabel: "尚无译文",
      alignmentStatus: "unavailable",
      issue: null,
      qualityIssues: [],
      readOnly: false,
      editing: false,
      canEdit: false,
      canRefreshDictionary: false,
      dictionaryOverrideCount: 0,
      dictionaryUnmatchedCount: 0,
      setLanguage: vi.fn(),
      setSourceKind: vi.fn(),
      setProducerKind: vi.fn(),
      beginEditing: vi.fn(),
      refreshDictionary: vi.fn(),
    },
    translationComparison: {
      aligned: false,
      sourceMode: "plain",
      sourceText: "",
      translatedText: "",
      parts: [],
      activeIds: [],
      pinned: false,
      dictionaryState: "idle",
      dictionaryMessage: null,
      setHover: vi.fn(),
      pin: vi.fn(),
      clearPin: vi.fn(),
    },
    history: {
      open: false,
      status: "idle",
      message: null,
      entries: [],
      toggle: vi.fn(),
      restore: vi.fn(),
    },
    dirty: false,
    tagsDirty: false,
    writePending: false,
    saveLabel: "保存 Tags",
    canSave: false,
    canDiscard: false,
    canDelete: true,
    deletePending: false,
    actionError: null,
    setText: vi.fn(),
    selectChannel: vi.fn(),
    selectTokenProfile: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    deleteCurrent: vi.fn(),
    ...overrides,
  };
}

function productionContent(
  overrides: Partial<AnnotationProductionContent> = {},
): AnnotationProductionContent {
  return {
    status: "inactive",
    entryIntent: "overview",
    lane: "tags",
    lanes: [
      {
        id: "tags",
        code: "TAG.01",
        title: "标签生产",
        summary: "本地视觉模型生成结构化标签修订",
        coveragePercent: 67,
        usableAssetCount: 2,
        missingAssetCount: 1,
        state: "attention",
      },
      {
        id: "description",
        code: "DSC.02",
        title: "描述生产",
        summary: "视觉语言模型生成逐图语义描述",
        coveragePercent: 33,
        usableAssetCount: 1,
        missingAssetCount: 2,
        state: "attention",
      },
      {
        id: "translation",
        code: "TRN.03",
        title: "译文生产",
        summary: "基于描述或标签生成目标语言译文",
        coveragePercent: 0,
        usableAssetCount: 0,
        missingAssetCount: 3,
        state: "inactive",
      },
    ],
    configuration: {
      scope: "all",
      scopeCount: 3,
      totalCount: 3,
      selectedCount: 1,
      folderPath: "set-a",
      folderOptions: [{ id: "set-a", label: "set-a", detail: "2 MATERIAL · set-a" }],
      folderLoading: false,
      backend: "local_tagger",
      backendOptions: [{ id: "local_tagger", label: "本地打标器" }],
      providerProfileId: "",
      providerProfileOptions: [],
      modelId: "",
      modelOptions: [],
      taggerProfileId: "tagger-1",
      taggerProfileOptions: [{ id: "tagger-1", label: "WD Tagger" }],
      promptPresetId: "",
      promptPresetOptions: [],
      targetLanguage: "zh-CN",
      targetLanguageOptions: [{ id: "zh-CN", label: "简体中文" }],
      translationSource: "description",
      translationPolicy: "skip",
      snapshot: [
        { id: "scope", label: "任务范围", value: "全项目", detail: "3 MATERIAL" },
        { id: "route", label: "生产线路", value: "TAGS", detail: "LOCAL TAGGER" },
      ],
      blockers: [],
      ready: true,
      pending: false,
      setScope: vi.fn(),
      setFolderPath: vi.fn(),
      setBackend: vi.fn(),
      setProviderProfile: vi.fn(),
      setModel: vi.fn(),
      setTaggerProfile: vi.fn(),
      setPromptPreset: vi.fn(),
      setTargetLanguage: vi.fn(),
      setTranslationSource: vi.fn(),
      setTranslationPolicy: vi.fn(),
      create: vi.fn(),
    },
    operation: null,
    message: null,
    selectLane: vi.fn(),
    createNew: vi.fn(),
    ...overrides,
  };
}

function projectContextContent(
  overrides: Partial<AnnotationProjectContextContent> = {},
): AnnotationProjectContextContent {
  return {
    status: "ready",
    message: null,
    systemPresetId: "preset-1",
    systemPresets: [{ id: "preset-1", name: "Dataset XML", systemPrompt: "Return XML." }],
    selectedSystemPrompt: "Return XML.",
    userPrompt: "Describe the current material.",
    useTagsAsContext: true,
    metadataStatus: "ready",
    metadataPath: "metadata/asset-1.json",
    metadataFields: [
      { id: "artist", selected: true },
      { id: "rating", selected: false },
    ],
    metadataRaw: '{\n  "artist": "sample"\n}',
    dirty: false,
    writePending: false,
    canSave: false,
    actionError: null,
    setSystemPreset: vi.fn(),
    setUserPrompt: vi.fn(),
    setUseTagsAsContext: vi.fn(),
    toggleMetadataField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    ...overrides,
  };
}

function requestPreviewContent(
  overrides: Partial<AnnotationRequestPreviewContent> = {},
): AnnotationRequestPreviewContent {
  return {
    status: "ready",
    message: null,
    basedOnSavedContext: false,
    configurationIssue: null,
    systemPresetName: "Dataset XML",
    systemPrompt: "Return XML.",
    userPrompt: "Describe the current material.",
    finalUserPrompt: 'Describe the current material.\n\nrating: "safe"\n\ntags: ["blue_hair"]',
    metadataLines: ['rating: "safe"'],
    tagContextStatus: "ready",
    tagCount: 1,
    tagLine: 'tags: ["blue_hair"]',
    ...overrides,
  };
}

function batchContent(overrides: Partial<AnnotationBatchContent> = {}): AnnotationBatchContent {
  return {
    rangeCount: 2,
    effectiveAssetIds: ["asset-1", "asset-2"],
    tags: {
      mode: "add",
      addDraft: "blue_hair",
      removeDraft: "",
      sourceDraft: "",
      replacementDraft: "",
      insertPosition: "end",
      insertIndex: "1",
      insertAnchor: "",
      modeDescription: "添加到列表末尾；已存在项会跳过。",
      requestError: null,
      notice: null,
      busy: false,
      canPreview: true,
      canExecute: true,
      preview: {
        requestedCount: 2,
        changedCount: 1,
        unchangedCount: 1,
        positionSkippedCount: 0,
        items: [
          {
            id: "asset-1",
            filename: "asset-1.png",
            relativePath: "images/asset-1.png",
            before: "portrait",
            after: "portrait, blue_hair",
            changed: true,
            positionSkipped: false,
          },
        ],
      },
      setMode: vi.fn(),
      setAddDraft: vi.fn(),
      setRemoveDraft: vi.fn(),
      setSourceDraft: vi.fn(),
      setReplacementDraft: vi.fn(),
      setInsertPosition: vi.fn(),
      setInsertIndex: vi.fn(),
      setInsertAnchor: vi.fn(),
      previewChanges: vi.fn(),
      executeChanges: vi.fn(),
    },
    deletion: {
      status: "ready",
      options: [
        {
          id: "tags",
          label: "Tags",
          activeCount: 2,
          staleCount: 0,
          selected: true,
          disabled: false,
        },
      ],
      selectedCount: 1,
      busy: false,
      actionError: null,
      notice: null,
      toggle: vi.fn(),
      toggleAll: vi.fn(),
      execute: vi.fn(),
    },
    ...overrides,
  };
}

function productionOperation(
  overrides: Partial<AnnotationProductionOperation> = {},
): AnnotationProductionOperation {
  return {
    id: "job-1",
    lane: "description",
    status: "running",
    statusLabel: "正在生产",
    tone: "active",
    progressPercent: 64,
    total: 100,
    pending: 35,
    running: 1,
    succeeded: 63,
    failed: 1,
    skipped: 0,
    candidates: 0,
    manuallyAccepted: 0,
    executionProfile: "Codex-Xuness",
    model: "gpt-5.6-sol",
    outputChannel: "description",
    scopeLabel: "全项目",
    createdAt: "2026-08-05T10:00:00Z",
    updatedAt: "2026-08-05T10:03:00Z",
    snapshot: [
      { id: "route", label: "输出线路", value: "DESCRIPTION REVISION" },
      { id: "model", label: "固定模型", value: "gpt-5.6-sol" },
    ],
    exceptions: [],
    exceptionCount: 0,
    loadingMore: false,
    canLoadMore: false,
    canStop: true,
    stopping: false,
    canResume: false,
    canRetry: false,
    actionPending: false,
    stop: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
    accept: vi.fn(),
    loadMore: vi.fn(),
    ...overrides,
  };
}

function dossierContent(
  overrides: Partial<AnnotationDossierContent> = {},
): AnnotationDossierContent {
  const provenance: AnnotationDossierProvenance = {
    id: "attempt-001",
    code: "LLM",
    title: "LLM 描述",
    model: "gpt-test",
    executionBackend: "provider",
    outputChannel: "description",
    startedAt: "2026-08-05T10:02:00Z",
    source: "model_response",
    current: true,
    readings: [
      { id: "job", label: "JOB", value: "job-001", detail: "completed" },
      { id: "model", label: "MODEL", value: "gpt-test", detail: "provider" },
    ],
    requestJson: '{\n  "model": "gpt-test"\n}',
    responseJson: '{\n  "finish_reason": "stop"\n}',
  };
  return {
    status: "ready",
    message: null,
    documents: [
      {
        id: "document-tags",
        code: "TAG.01",
        title: "标签记录",
        status: "valid",
        statusLabel: "当前可用",
        availability: "usable",
        language: null,
        source: "Tagger 生成",
        reviewStatus: "reviewed",
        updatedAt: "2026-08-05T10:00:00Z",
        revisionId: "revision-tags-001",
        imageHash: "image-hash-001",
        validationMessage: null,
      },
      {
        id: "document-description",
        code: "DSC.02",
        title: "描述记录",
        status: "valid",
        statusLabel: "当前可用",
        availability: "usable",
        language: null,
        source: "LLM 生成",
        reviewStatus: "unreviewed",
        updatedAt: "2026-08-05T10:03:00Z",
        revisionId: "revision-description-001",
        imageHash: "image-hash-001",
        validationMessage: null,
      },
    ],
    metadata: {
      exists: true,
      path: "metadata/asset-1.json",
      fields: [
        { id: "score:0", label: "score", value: "0.94", kind: "NUMBER" },
        { id: "source:1", label: "source", value: "local camera", kind: "TEXT" },
      ],
      raw: '{\n  "score": 0.94\n}',
      error: null,
    },
    revisions: [
      {
        id: "revision-description-001",
        channel: "description",
        channelLabel: "描述记录",
        source: "LLM 生成",
        createdAt: "2026-08-05T10:03:00Z",
        preview: "A portrait specimen under controlled lighting.",
        candidate: false,
        tombstone: false,
        validationStatus: "valid",
        jobItemId: "job-item-001",
        imageHash: "image-hash-001",
      },
    ],
    translations: [
      {
        id: "zh-CN:description:llm",
        language: "zh-CN",
        sourceKind: "description",
        producerKind: "llm",
        status: "current",
        statusLabel: "源版本一致",
        producer: "语言模型",
        model: "gpt-test",
        provider: "primary",
        updatedAt: "2026-08-05T10:04:00Z",
        sourceRevisionId: "revision-description-001",
        sourceHash: "source-hash-001",
        currentSourceHash: "source-hash-001",
        qualityStatus: "valid",
        alignmentStatus: "aligned",
        issue: null,
        qualityIssues: [],
      },
    ],
    provenance,
    provenanceHistory: [provenance],
    selectedProvenanceId: provenance.id,
    provenanceLoading: false,
    provenanceIssue: null,
    jobs: [
      {
        id: "job-001",
        itemId: "job-item-001",
        kind: "annotation",
        kindLabel: "标注生产",
        jobStatus: "completed",
        jobStatusLabel: "生产完成",
        itemStatus: "succeeded",
        itemStatusLabel: "处理成功",
        resultDisposition: "applied",
        executionProfile: "primary",
        model: "gpt-test",
        outputChannel: "description",
        attemptCount: 1,
        createdAt: "2026-08-05T10:00:00Z",
        updatedAt: "2026-08-05T10:03:00Z",
        error: null,
      },
    ],
    jobsLoading: false,
    jobsIssue: null,
    selectProvenance: vi.fn(),
    openJob: vi.fn(),
    openArchive: vi.fn(),
    openQuality: vi.fn(),
    ...overrides,
  };
}

function stageContent(overrides: Partial<AnnotationStageContent> = {}): AnnotationStageContent {
  const assets = [stageAsset("asset-1", 0), stageAsset("asset-2", 1), stageAsset("asset-3", 2)];
  return {
    kind: "annotation-stage",
    status: "ready",
    project: {
      id: "project-1",
      name: "Portrait Set",
      rootPath: "D:\\datasets\\portraits",
      exists: true,
      assetCount: 3,
      annotatedCount: 2,
      invalidCount: 0,
    },
    sequence: {
      assets,
      totalCount: 3,
      loadedCount: 3,
      fetchingMore: false,
      hasMore: false,
      loadError: null,
      loadMore: vi.fn(),
    },
    scope: {
      search: "",
      filter: "all",
      filters: [{ id: "all", label: "全部素材", code: "ALL" }],
      selectingAll: false,
      actionError: null,
      setSearch: vi.fn(),
      setFilter: vi.fn(),
      toggleRangeTo: vi.fn(),
      clearChecked: vi.fn(),
      selectAllFiltered: vi.fn(),
    },
    currentAsset: assets[0],
    currentIndex: 0,
    checkedAssetIds: [],
    channels: [],
    operation: null,
    activeWorkcell: null,
    overview: { batch: null },
    editWorkcell: { channel: "tags", editor: editContent() },
    productionWorkcell: {
      production: productionContent(),
      projectContext: null,
      requestPreview: null,
    },
    dossierWorkcell: { section: "channels", dossier: dossierContent() },
    confirmation: null,
    message: null,
    selectAsset: vi.fn(),
    stepAsset: vi.fn(),
    toggleAssetChecked: vi.fn(),
    selectDossierSection: vi.fn(),
    openWorkcell: vi.fn(),
    closeWorkcell: vi.fn(),
    selectEditChannel: vi.fn(),
    resolveConfirmation: vi.fn(),
    returnToSpace: vi.fn(),
    openArchive: vi.fn(),
    ...overrides,
  };
}

function renderStage(content: AnnotationStageContent) {
  return render(
    <DialArchiveSpacePage
      space={getHomeSpace("annotation")}
      content={content}
      onNavigateSpace={vi.fn()}
      onReturnHome={vi.fn()}
    />,
  );
}

describe("dial archive annotation stage", () => {
  beforeEach(() => mockMatchMedia(true));

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(window, "matchMedia");
  });

  test("presents the current material and true sequence readings", () => {
    renderStage(stageContent());

    expect(screen.getByRole("region", { name: "素材施工场" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "素材 asset-1.png 查看器" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "图片观察工具" })).not.toBeNull();
    expect(screen.getByText("0001")).not.toBeNull();
    expect(screen.getByText("3 MATERIAL")).not.toBeNull();
  });

  test("inspects the true-color image with normal-wheel zoom, actual size, and drag pan", () => {
    renderStage(stageContent());

    const viewer = screen.getByRole("group", { name: "素材 asset-1.png 查看器" });
    Object.defineProperties(viewer, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 500 },
    });
    vi.spyOn(viewer, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 800,
      bottom: 500,
      left: 0,
      width: 800,
      height: 500,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    expect(screen.getByLabelText("图片缩放比例")).toHaveProperty("value", "100%");
    fireEvent.wheel(viewer, { deltaY: -120, clientX: 400, clientY: 250 });
    expect(screen.getByLabelText("图片缩放比例")).not.toHaveProperty("value", "100%");

    const surface = screen.getByAltText("asset-1.png").parentElement;
    fireEvent.pointerDown(viewer, { button: 0, pointerId: 7, clientX: 400, clientY: 250 });
    fireEvent.pointerMove(viewer, { pointerId: 7, clientX: 450, clientY: 290 });
    fireEvent.pointerUp(viewer, { pointerId: 7, clientX: 450, clientY: 290 });
    expect(surface?.style.transform).toBe("translate3d(50px, 40px, 0)");
  });

  test("keeps current-object selection and range toggling as two gestures", () => {
    const content = stageContent();
    renderStage(content);

    const cell = screen.getByRole("button", { name: "查看素材 asset-2.png" });
    fireEvent.click(cell);
    expect(content.selectAsset).toHaveBeenCalledWith("asset-2");
    expect(content.toggleAssetChecked).not.toHaveBeenCalled();

    fireEvent.click(cell, { altKey: true });
    expect(content.toggleAssetChecked).toHaveBeenCalledWith("asset-2");

    fireEvent.click(cell, { shiftKey: true });
    expect(content.scope.toggleRangeTo).toHaveBeenCalledWith("asset-2");
  });

  test("filters and selects the material range from the filmstrip instrument", () => {
    const content = stageContent();
    renderStage(content);

    fireEvent.click(screen.getByRole("button", { name: /RANGE DOCK/u }));
    fireEvent.change(screen.getByRole("searchbox", { name: "FIND MATERIAL" }), {
      target: { value: "portrait" },
    });
    expect(content.scope.setSearch).toHaveBeenCalledWith("portrait");
    fireEvent.change(screen.getByRole("combobox", { name: "OBJECT STATE" }), {
      target: { value: "all" },
    });
    expect(content.scope.setFilter).toHaveBeenCalledWith("all");
    fireEvent.click(screen.getByRole("button", { name: "选择全部筛选结果" }));
    expect(content.scope.selectAllFiltered).toHaveBeenCalledOnce();
  });

  test("keeps the filmstrip viewport still when a visible material becomes current", () => {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        x: left,
        y: top,
        top,
        right: left + width,
        bottom: top + height,
        left,
        width,
        height,
        toJSON: () => ({}),
      }) satisfies DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("dial-archive-stage-filmstrip")) return rect(0, 0, 1_000, 164);
      const filmIndex = this.getAttribute("data-film-index");
      if (filmIndex !== null) return rect(650 + Number(filmIndex) * 130, 24, 144, 96);
      return rect(0, 0, 0, 0);
    });

    const { container } = renderStage(stageContent());
    const track = container.querySelector<HTMLElement>(".dial-archive-stage-filmstrip__track");
    expect(track?.style.transform).toBe("translateX(0px)");

    fireEvent.click(screen.getByRole("button", { name: "查看素材 asset-3.png" }));

    expect(track?.style.transform).toBe("translateX(0px)");
    expect(screen.getByRole("button", { name: "查看素材 asset-3.png" }).className).toContain(
      "is-current",
    );
  });

  test("marks ranged materials with the bite while the current one keeps its identity frame", () => {
    const content = stageContent({ checkedAssetIds: ["asset-2"] });
    renderStage(content);

    const current = screen.getByRole("button", { name: "查看素材 asset-1.png" });
    const ranged = screen.getByRole("button", { name: "查看素材 asset-2.png" });
    expect(current.className).toContain("is-current");
    expect(current.className).not.toContain("is-ranged");
    expect(ranged.className).toContain("is-ranged");
    expect(ranged.className).not.toContain("is-current");
  });

  test("coalesces rapid keyboard intent after a child control receives focus", () => {
    const content = stageContent();
    renderStage(content);

    const focusedCell = screen.getByRole("button", { name: "查看素材 asset-1.png" });
    focusedCell.focus();
    fireEvent.keyDown(focusedCell, { key: "ArrowRight" });
    fireEvent.keyDown(focusedCell, { key: "ArrowRight" });

    expect(content.selectAsset).toHaveBeenNthCalledWith(1, "asset-2");
    expect(content.selectAsset).toHaveBeenNthCalledWith(2, "asset-3");
    expect(screen.getByText("0003")).not.toBeNull();
  });

  test("steps the optimistic sequence from the instrument pager", () => {
    const content = stageContent();
    renderStage(content);

    fireEvent.click(screen.getByRole("button", { name: "下一张素材" }));
    expect(content.selectAsset).toHaveBeenCalledWith("asset-2");
    expect(screen.getByRole("button", { name: "上一张素材" })).toHaveProperty("disabled", false);
  });

  test("moves the bounded camera only when the gesture starts on blank stage space", () => {
    renderStage(stageContent());

    const stage = screen.getByRole("region", { name: "素材施工场" });
    const lockedControl = screen.getByRole("button", { name: /RESET 0\.0/u });
    fireEvent.pointerDown(lockedControl, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 140, clientY: 122 });
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-x")).toBe("0px");

    fireEvent.pointerDown(stage, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 440, clientY: 300 });
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 440, clientY: 300 });
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-x")).toBe("76px");
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-y")).toBe("44px");

    fireEvent.click(lockedControl);
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-x")).toBe("0px");
    expect(stage.style.getPropertyValue("--dial-archive-stage-camera-y")).toBe("0px");
  });

  test("opens each workcell through the depth stack", () => {
    const content = stageContent();
    renderStage(content);

    fireEvent.click(screen.getByRole("button", { name: /展开生产工作间/u }));
    expect(content.openWorkcell).toHaveBeenCalledWith("production");

    fireEvent.click(screen.getByRole("button", { name: /展开档案工作间/u }));
    expect(content.openWorkcell).toHaveBeenCalledWith("dossier");

    fireEvent.click(screen.getByRole("button", { name: "打开标注编辑工作间" }));
    expect(content.openWorkcell).toHaveBeenCalledWith("edit");
  });

  test("expands the edit workcell around the persistent current material", () => {
    const content = stageContent({ activeWorkcell: "edit" });
    renderStage(content);

    expect(screen.getByRole("region", { name: "标注编辑工作间" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "素材 asset-1.png 查看器" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "标注编辑" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /DSC\.02描述/u }));
    expect(content.editWorkcell.editor?.selectChannel).toHaveBeenCalledWith("description");

    fireEvent.click(screen.getByRole("button", { name: /WC\.02自动生产/u }));
    expect(content.openWorkcell).toHaveBeenCalledWith("production");

    fireEvent.click(screen.getByRole("button", { name: /RETURN.*STAGE OVERVIEW/u }));
    expect(content.closeWorkcell).toHaveBeenCalledOnce();
  });

  test("keeps the edit workcell focused on annotation documents", () => {
    const content = stageContent({ activeWorkcell: "edit" });
    renderStage(content);

    expect(screen.getByRole("navigation", { name: "标注编辑通道" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /项目上下文/u })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Tags 批量变更" })).toBeNull();
  });

  test("edits project prompt context from the production input stage", () => {
    const context = projectContextContent({ dirty: true, canSave: true });
    renderStage(
      stageContent({
        activeWorkcell: "production",
        productionWorkcell: {
          production: productionContent({ status: "configure", entryIntent: "lane" }),
          projectContext: context,
          requestPreview: requestPreviewContent(),
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /CONTEXT项目上下文/u }));
    const compactContext = document.querySelector(".dial-archive-context-surface.is-inspector");
    expect(compactContext).not.toBeNull();
    const contextRegisters =
      compactContext?.querySelectorAll<HTMLDetailsElement>(
        ".dial-archive-context-surface__evidence > .dial-archive-context-surface__register",
      ) ?? [];
    expect(contextRegisters).toHaveLength(2);
    expect(contextRegisters[0]?.open).toBe(false);
    expect(contextRegisters[1]?.open).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("输入在当前项目中保持稳定的 User Prompt…"), {
      target: { value: "A revised instruction." },
    });
    expect(context.setUserPrompt).toHaveBeenCalledWith("A revised instruction.");
    fireEvent.click(screen.getByRole("button", { name: "rating" }));
    expect(context.toggleMetadataField).toHaveBeenCalledWith("rating");
    fireEvent.click(screen.getByRole("button", { name: "保存项目上下文" }));
    expect(context.save).toHaveBeenCalledOnce();
  });

  test("shows the next final request as saved system, context and user evidence", () => {
    renderStage(
      stageContent({
        activeWorkcell: "production",
        productionWorkcell: {
          production: productionContent({ status: "configure", entryIntent: "lane" }),
          projectContext: projectContextContent(),
          requestPreview: requestPreviewContent({ basedOnSavedContext: true }),
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "检查生产节点 路线校验" }));
    expect(screen.getByRole("heading", { name: "最终请求预览" })).not.toBeNull();
    const compactRequest = document.querySelector(".dial-archive-request-preview.is-inspector");
    expect(compactRequest).not.toBeNull();
    const requestRegisters = compactRequest?.querySelectorAll<HTMLDetailsElement>(
      ".dial-archive-request-preview__messages > details",
    );
    expect(requestRegisters).toHaveLength(3);
    expect(requestRegisters?.[0]?.open).toBe(false);
    expect(requestRegisters?.[1]?.open).toBe(false);
    expect(requestRegisters?.[2]?.open).toBe(true);
    expect(
      screen.getByText("本页严格展示最后保存配置生成的真实下次请求。", { exact: false }),
    ).not.toBeNull();
    expect(screen.getByText('tags: ["blue_hair"]')).not.toBeNull();
  });

  test("requires a tag preview and explicit channel selection for batch writes", () => {
    const batch = batchContent();
    renderStage(
      stageContent({
        overview: { batch },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /RANGE DOCK/u }));
    fireEvent.click(screen.getByRole("button", { name: /02批量施工/u }));
    expect(screen.getByRole("heading", { name: "Tags 批量变更" })).not.toBeNull();
    expect(screen.getByText("portrait, blue_hair")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "执行已预览变更" }));
    expect(batch.tags.executeChanges).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /删除 1 类标注/u }));
    expect(batch.deletion.execute).toHaveBeenCalledOnce();
  });

  test("builds a production route from the selected film range without another image screen", () => {
    const production = productionContent({ status: "configure" });
    const content = stageContent({
      activeWorkcell: "production",
      checkedAssetIds: ["asset-2"],
      productionWorkcell: {
        production: { ...production, entryIntent: "lane" },
        projectContext: projectContextContent(),
        requestPreview: requestPreviewContent(),
      },
    });
    renderStage(content);

    expect(screen.getByRole("region", { name: "自动生产工作间" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "可拖动的生产路由画布" })).not.toBeNull();
    const productionRoute = screen.getByRole("region", { name: "生产线路" });
    expect(productionRoute).not.toBeNull();
    expect(screen.getByRole("heading", { name: "标签生产线路" })).not.toBeNull();
    expect(screen.queryByText("PARAMETERS READY")).toBeNull();
    expect(screen.getByText("SOURCE EVIDENCE")).not.toBeNull();
    expect(productionRoute.dataset.canvasParity).toBe("space-02");
    expect(productionRoute.querySelectorAll(".dial-archive-production-canvas-node")).toHaveLength(
      8,
    );
    expect(
      productionRoute.querySelectorAll(".dial-archive-preparation-canvas__frame"),
    ).toHaveLength(5);
    expect(
      productionRoute.querySelectorAll(".dial-archive-preparation-canvas__field"),
    ).toHaveLength(4);
    expect(productionRoute.querySelectorAll(".dial-archive-preparation-gauge")).toHaveLength(2);
    expect(
      productionRoute.querySelectorAll(".dial-archive-preparation-connectors__main > path"),
    ).toHaveLength(12);
    let inputNavigation = screen.getByRole("navigation", { name: "生产输入阶段" });
    expect(inputNavigation.textContent).toContain("CONFIG");
    expect(inputNavigation.textContent).toContain("CONTEXT");
    expect(inputNavigation.textContent).not.toContain("REQUEST");
    fireEvent.click(screen.getByRole("group", { name: "任务素材范围" }));
    expect(screen.getByRole("heading", { name: "处理范围" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "素材范围装配" })).not.toBeNull();
    inputNavigation = screen.getByRole("navigation", { name: "生产输入阶段" });
    expect(inputNavigation.textContent).toContain("CONFIG");
    expect(inputNavigation.textContent).not.toContain("CONTEXT");
    expect(inputNavigation.textContent).not.toContain("REQUEST");
    fireEvent.click(screen.getByRole("button", { name: /DIR\.02工作目录子文件夹/u }));
    expect(production.configuration.setScope).toHaveBeenCalledWith("folder");
    fireEvent.click(screen.getByRole("button", { name: "检查生产节点 路线校验" }));
    inputNavigation = screen.getByRole("navigation", { name: "生产输入阶段" });
    expect(inputNavigation.textContent).toContain("REQUEST");
    expect(inputNavigation.textContent).not.toContain("CONFIG");
    expect(inputNavigation.textContent).not.toContain("CONTEXT");
    fireEvent.click(screen.getByRole("tab", { name: /标签生产/u }));
    expect(
      screen
        .getByRole("complementary", { name: "生产执行检查器" })
        .classList.contains("dial-archive-preparation-inspector"),
    ).toBe(true);
    expect(
      screen
        .getByRole("tab", { name: /标签生产/u })
        .classList.contains("dial-archive-preparation-node"),
    ).toBe(true);
    expect(screen.queryByText("FROZEN EXECUTION SNAPSHOT")).toBeNull();
    expect(screen.queryByRole("button", { name: /建立并启动生产任务/u })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭生产执行检查器" }));
    expect(screen.queryByRole("heading", { name: "标签生产线路" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /打开生产执行检查器：TAGS/u }));
    expect(screen.getByRole("heading", { name: "标签生产线路" })).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /描述生产/u }));
    expect(production.selectLane).toHaveBeenCalledWith("description");
    expect(screen.getByRole("heading", { name: "描述生产线路" })).not.toBeNull();

    const commit = screen.getByRole("button", { name: "打开合流写入检查器" });
    fireEvent.click(commit);
    expect(screen.getByRole("heading", { name: "合流写入" })).not.toBeNull();
    expect(commit.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("冻结执行快照")).not.toBeNull();
    expect(
      (screen.getByText("FROZEN EXECUTION SNAPSHOT").closest("details") as HTMLDetailsElement).open,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /建立并启动生产任务/u }));
    expect(production.configuration.create).toHaveBeenCalledOnce();
  });

  test("configures an actual workspace subfolder from the scope node", () => {
    const baseProduction = productionContent({ status: "configure", entryIntent: "lane" });
    const setFolderPath = vi.fn();
    const production: AnnotationProductionContent = {
      ...baseProduction,
      configuration: {
        ...baseProduction.configuration,
        scope: "folder",
        scopeCount: 2,
        folderPath: "set-a",
        folderOptions: [
          { id: "set-a", label: "set-a", detail: "2 MATERIAL · set-a" },
          { id: "set-b", label: "set-b", detail: "1 MATERIAL · set-b" },
        ],
        setFolderPath,
      },
    };
    renderStage(
      stageContent({
        activeWorkcell: "production",
        productionWorkcell: {
          production,
          projectContext: projectContextContent(),
          requestPreview: requestPreviewContent(),
        },
      }),
    );

    fireEvent.click(screen.getByRole("group", { name: "任务素材范围" }));
    const folder = screen.getByRole("combobox", { name: "素材子文件夹" });
    expect((folder as HTMLSelectElement).value).toBe("set-a");
    fireEvent.change(folder, { target: { value: "set-b" } });
    expect(setFolderPath).toHaveBeenCalledWith("set-b");
  });

  test("keeps a running operation on the same route topology", () => {
    const operation = productionOperation();
    renderStage(
      stageContent({
        activeWorkcell: "production",
        productionWorkcell: {
          production: productionContent({
            status: "operation",
            entryIntent: "operation",
            lane: "description",
            operation,
          }),
          projectContext: null,
          requestPreview: null,
        },
      }),
    );

    expect(screen.getAllByText("正在生产").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("64")).not.toBeNull();
    expect(screen.getByText("NO DIVERGENCE")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /停止任务/u }));
    expect(operation.stop).toHaveBeenCalledOnce();
  });

  test("opens a read-only object dossier from real evidence registers", () => {
    const dossier = dossierContent();
    const content = stageContent({
      activeWorkcell: "dossier",
      dossierWorkcell: { section: "channels", dossier },
    });
    renderStage(content);

    expect(screen.getByRole("region", { name: "素材施工场" }).getAttribute("data-workcell")).toBe(
      "dossier",
    );
    expect(screen.getByRole("region", { name: "对象档案工作间" })).not.toBeNull();
    expect(screen.getByRole("complementary", { name: "当前对象证据台" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "通道登记" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /02素材元数据/u }));
    expect(content.selectDossierSection).toHaveBeenCalledWith("metadata");
    fireEvent.click(screen.getByRole("button", { name: /06生成与请求溯源/u }));
    expect(content.selectDossierSection).toHaveBeenCalledWith("provenance");
    fireEvent.click(screen.getByRole("button", { name: /项目档案/u }));
    expect(dossier.openArchive).toHaveBeenCalledOnce();
  });

  test("switches between LLM and Tagger generation traces in the object dossier", () => {
    const dossier = dossierContent();
    const llmTrace = dossier.provenance!;
    const taggerTrace: AnnotationDossierProvenance = {
      ...llmTrace,
      id: "attempt-tagger-001",
      code: "TAG",
      title: "Tagger 标签",
      model: "CL Tagger",
      executionBackend: "local_tagger",
      outputChannel: "tags",
      startedAt: "2026-08-05T09:58:00Z",
      current: false,
    };
    dossier.provenanceHistory = [llmTrace, taggerTrace];
    dossier.selectedProvenanceId = llmTrace.id;

    renderStage(
      stageContent({
        activeWorkcell: "dossier",
        dossierWorkcell: { section: "provenance", dossier },
      }),
    );

    expect(screen.getByRole("navigation", { name: "生成调用历史" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /LLM 描述/u }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    const taggerButton = screen.getByRole("button", { name: /Tagger 标签/u });
    fireEvent.click(taggerButton);
    expect(dossier.selectProvenance).toHaveBeenCalledWith("attempt-tagger-001");
    expect(screen.getByText(/REQUEST ENVELOPE/u)).not.toBeNull();
    expect(screen.getByText(/RESPONSE ENVELOPE/u)).not.toBeNull();
  });

  test("keeps the core dossier readable when optional registers fail", () => {
    renderStage(
      stageContent({
        activeWorkcell: "dossier",
        dossierWorkcell: {
          section: "jobs",
          dossier: dossierContent({
            jobs: [],
            jobsIssue: "Not Found",
            provenance: null,
            provenanceIssue: "Trace unavailable",
          }),
        },
      }),
    );

    expect(screen.getByRole("heading", { name: "关联生产任务" })).not.toBeNull();
    expect(screen.getByText(/关联任务暂时不可用/u)).not.toBeNull();
    expect(screen.queryByText("对象档案未能完整建立")).toBeNull();
  });

  test("keeps the same workcell plane mounted while it returns to the overview", () => {
    mockMatchMedia(false);
    const onNavigateSpace = vi.fn();
    const onReturnHome = vi.fn();
    const { container, rerender } = render(
      <DialArchiveSpacePage
        space={getHomeSpace("annotation")}
        content={stageContent({ activeWorkcell: "edit" })}
        onNavigateSpace={onNavigateSpace}
        onReturnHome={onReturnHome}
      />,
    );
    const plane = container.querySelector(".dial-archive-workcell-viewport__plane");

    rerender(
      <DialArchiveSpacePage
        space={getHomeSpace("annotation")}
        content={stageContent({ activeWorkcell: null })}
        onNavigateSpace={onNavigateSpace}
        onReturnHome={onReturnHome}
      />,
    );

    expect(container.querySelector(".dial-archive-stage")?.className).toContain(
      "is-workcell-closing",
    );
    expect(container.querySelector(".dial-archive-workcell-viewport__plane")).toBe(plane);
  });

  test("closes an active workcell with Escape without treating it as asset navigation", () => {
    const content = stageContent({ activeWorkcell: "edit" });
    renderStage(content);

    fireEvent.keyDown(screen.getByRole("region", { name: "标注编辑工作间" }), {
      key: "Escape",
    });

    expect(content.closeWorkcell).toHaveBeenCalledOnce();
    expect(content.stepAsset).not.toHaveBeenCalled();
  });

  test("shows the live operation reading on the production card", () => {
    renderStage(
      stageContent({
        operation: {
          id: "job-1",
          kind: "annotation",
          lane: "tags",
          status: "running",
          statusLabel: "正在生产",
          progressPercent: 62,
          completedItems: 62,
          totalItems: 100,
          failedItems: 0,
          targetLanguage: null,
          executionProfileName: "default",
          model: "wd-tagger",
          createdAt: "2026-08-04T10:00:00Z",
          updatedAt: "2026-08-04T10:05:00Z",
          active: true,
        },
      }),
    );

    expect(screen.getByText("正在生产 62%")).not.toBeNull();
  });

  test("directs an empty context back to the project archive", () => {
    const content = stageContent({
      status: "no-context",
      project: null,
      currentAsset: null,
      currentIndex: -1,
    });
    renderStage(content);

    fireEvent.click(screen.getByRole("button", { name: /进入项目档案/u }));
    expect(content.openArchive).toHaveBeenCalledOnce();
  });

  test("keeps the stage identity when an asset image fails to load", () => {
    const content = stageContent();
    renderStage(content);

    fireEvent.error(screen.getByAltText("asset-1.png"));
    expect(screen.getByText("IMAGE UNAVAILABLE")).not.toBeNull();
    expect(screen.getAllByText("images/asset-1.png").length).toBeGreaterThanOrEqual(1);
  });

  test("offers an explicit retry instead of looping after sequence pagination fails", () => {
    const loadMore = vi.fn();
    renderStage(
      stageContent({
        sequence: {
          ...stageContent().sequence,
          hasMore: true,
          loadError: "下一页读取失败",
          loadMore,
        },
        message: "下一页读取失败",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "RETRY SEQUENCE →" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });
});
