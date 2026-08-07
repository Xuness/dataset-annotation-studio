import { Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  getHomeSpace,
  getHomeSpaceByRoute,
  type HomeSpace,
  type HomeSpaceId,
} from "../navigation/spaceRegistry";
import { useArchiveSpaceController } from "../pages/spaces/archive/useArchiveSpaceController";
import {
  isAnnotationEditChannelId,
  isAnnotationLaneId,
} from "../pages/spaces/annotation/annotationSpaceModel";
import { isAnnotationWorkcellId } from "../pages/spaces/annotation/annotationStageModel";
import { useAnnotationSpaceController } from "../pages/spaces/annotation/useAnnotationSpaceController";
import {
  createNoContextAnnotationStage,
  useAnnotationStageController,
} from "../pages/spaces/annotation/useAnnotationStageController";
import {
  isCapabilityLibraryCategoryId,
  type CapabilityLibraryCategoryId,
  type CapabilityLibraryGroupId,
} from "../pages/spaces/capability-library/capabilityLibraryModel";
import { useCapabilityCategoryController } from "../pages/spaces/capability-library/useCapabilityCategoryController";
import { useCapabilityDownloadWorkbenchController } from "../pages/spaces/capability-library/useCapabilityDownloadWorkbenchController";
import { useCapabilitySystemWorkbenchController } from "../pages/spaces/capability-library/useCapabilitySystemWorkbenchController";
import {
  capabilityObjectPath,
  parseCapabilityPath,
} from "../pages/spaces/capability/capabilitySpaceModel";
import { useCapabilitySpaceController } from "../pages/spaces/capability/useCapabilitySpaceController";
import { useDeliverySpaceController } from "../pages/spaces/delivery/useDeliverySpaceController";
import { useCapabilityLibraryController } from "../pages/spaces/capability-library/useCapabilityLibraryController";
import {
  createNoContextDeliveryWorkbench,
  useDeliveryWorkbenchController,
} from "../pages/spaces/delivery/useDeliveryWorkbenchController";
import { isQualityFilterId } from "../pages/spaces/quality/qualitySpaceModel";
import {
  createNoContextQualityReview,
  useQualityReviewController,
} from "../pages/spaces/quality/useQualityReviewController";
import {
  createNoContextQualitySpace,
  useQualitySpaceController,
} from "../pages/spaces/quality/useQualitySpaceController";
import {
  isPreparationCanvasNodeId,
  isPreparationCapabilityId,
} from "../pages/spaces/preparation/preparationModel";
import { usePreparationSpaceController } from "../pages/spaces/preparation/usePreparationSpaceController";
import {
  createNoContextPreparationWorkbench,
  usePreparationWorkbenchController,
} from "../pages/spaces/preparation/usePreparationWorkbenchController";
import type {
  AnnotationDossierSectionId,
  AnnotationLaneId,
  AnnotationEditChannelId,
  AnnotationWorkcellId,
  CapabilityDistrictId,
  CapabilityDownloadCategoryId,
  CapabilityObjectRecord,
  CapabilitySystemSectionId,
  PreparationCanvasNodeId,
  PreparationCapabilityId,
  QualityFilterId,
  SpacePageContent,
} from "../pages/spaces/spacePageModel";
import { ANNOTATION_DOSSIER_SECTION_IDS } from "../pages/spaces/spacePageModel";
import { getFrontendTheme, resolveFrontendThemeId } from "../themes/themeRegistry";
import type { ThemeSpacePageProps } from "../themes/themeTypes";
import { buildFrontendHref, readInitialHomeSpaceId, readRouteIdentifier } from "./routeState";
import { useProjectRouteContext } from "./useProjectRouteContext";

interface ThemeFrameProps {
  themeId: string;
  children: ReactNode;
}

function ThemeFrame({ themeId, children }: ThemeFrameProps) {
  return (
    <div className="frontend-theme-host" data-frontend-theme={themeId}>
      <Suspense fallback={<div className="frontend-theme-loading">LOADING INTERFACE</div>}>
        {children}
      </Suspense>
    </div>
  );
}

function HomeRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const { HomePage } = getFrontendTheme(themeId);

  return (
    <ThemeFrame themeId={themeId}>
      <HomePage
        initialSpaceId={readInitialHomeSpaceId(location.search)}
        onEnterSpace={(spaceId) =>
          navigate(
            buildFrontendHref(getHomeSpace(spaceId).route, {
              themeId,
              projectId,
            }),
          )
        }
      />
    </ThemeFrame>
  );
}

interface SpaceRouteViewProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  content: SpacePageContent;
  themeId: string;
  projectId: string | null;
}

function SpaceRouteView({ Page, space, content, themeId, projectId }: SpaceRouteViewProps) {
  const navigate = useNavigate();
  const navigateSpace = (spaceId: HomeSpaceId) => {
    navigate(buildFrontendHref(getHomeSpace(spaceId).route, { themeId, projectId }));
  };
  const returnHome = (spaceId: HomeSpaceId) => {
    navigate(
      buildFrontendHref("/", {
        themeId,
        projectId,
        initialSpace: getHomeSpace(spaceId),
      }),
    );
  };

  return (
    <ThemeFrame themeId={themeId}>
      <Page
        space={space}
        content={content}
        onNavigateSpace={navigateSpace}
        onReturnHome={returnHome}
      />
    </ThemeFrame>
  );
}

interface ArchiveRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string | null;
  onProjectIdChange(projectId: string | null): void;
}

interface CapabilityRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string | null;
}

function CapabilityRoute({ Page, space, themeId, projectId }: CapabilityRouteProps) {
  const navigate = useNavigate();
  const content = useCapabilityLibraryController({
    onOpenCategory: (categoryId) =>
      navigate(
        buildFrontendHref(`/capability/${categoryId}`, {
          themeId,
          projectId,
        }),
      ),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

interface LoadedCapabilityCategoryRouteProps extends CapabilityRouteProps {
  categoryId: CapabilityLibraryCategoryId;
  requestedGroupId: string | null;
  requestedResourceId: string | null;
}

function capabilityModulePath(
  categoryId: CapabilityLibraryCategoryId,
  groupId: CapabilityLibraryGroupId,
): string | null {
  if (categoryId === "taggers" && groupId === "runtime") return "/capability/taggers/runtime";
  if (categoryId === "taggers" && groupId === "downloads") {
    return "/capability/taggers/downloads";
  }
  if (categoryId === "dictionaries" && groupId === "overrides") {
    return "/capability/dictionaries/overrides";
  }
  if (categoryId === "dictionaries" && groupId === "downloads") {
    return "/capability/dictionaries/downloads";
  }
  return null;
}

function LoadedCapabilityCategoryRoute({
  Page,
  space,
  themeId,
  projectId,
  categoryId,
  requestedGroupId,
  requestedResourceId,
}: LoadedCapabilityCategoryRouteProps) {
  const navigate = useNavigate();
  const categoryHref = (
    nextCategoryId: string,
    groupId: string | null = null,
    resourceId: string | null = null,
  ) =>
    buildFrontendHref(`/capability/${nextCategoryId}`, {
      themeId,
      projectId,
      query: { view: groupId, focus: resourceId },
    });
  const content = useCapabilityCategoryController({
    categoryId,
    requestedGroupId,
    requestedResourceId,
    onCategoryChange: (nextCategoryId) => navigate(categoryHref(nextCategoryId)),
    onGroupIdChange: (groupId) => {
      const modulePath = capabilityModulePath(categoryId, groupId);
      navigate(
        modulePath
          ? buildFrontendHref(modulePath, { themeId, projectId })
          : categoryHref(categoryId, groupId),
      );
    },
    onResourceIdChange: (groupId, resourceId) =>
      navigate(categoryHref(categoryId, groupId, resourceId)),
    onCreateResource: () =>
      navigate(buildFrontendHref("/capability/providers/new", { themeId, projectId })),
    onOpenWorkbench: (resource) =>
      navigate(buildFrontendHref(resource.workbenchPath, { themeId, projectId })),
    onReturnOverview: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
  });

  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function CapabilityCategoryRoute() {
  const location = useLocation();
  const { categoryId } = useParams();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("capability");

  if (!isCapabilityLibraryCategoryId(categoryId)) {
    return (
      <Navigate
        replace
        to={buildFrontendHref(space.route, {
          themeId,
          projectId,
        })}
      />
    );
  }

  return (
    <LoadedCapabilityCategoryRoute
      Page={theme.SpacePage}
      space={space}
      themeId={themeId}
      projectId={projectId}
      categoryId={categoryId}
      requestedGroupId={readRouteIdentifier(location.search, "view")}
      requestedResourceId={readRouteIdentifier(location.search, "focus")}
    />
  );
}

const CAPABILITY_DISTRICT_DEFAULT_VIEWS: Readonly<Record<CapabilityDistrictId, string>> = {
  providers: "connections",
  taggers: "profiles",
  dictionaries: "installations",
  prompts: "system",
};

interface LoadedCapabilityObjectWorkbenchRouteProps extends CapabilityRouteProps {
  pathname: string;
}

function LoadedCapabilityObjectWorkbenchRoute({
  Page,
  space,
  themeId,
  projectId,
  pathname,
}: LoadedCapabilityObjectWorkbenchRouteProps) {
  const navigate = useNavigate();
  const selection = parseCapabilityPath(pathname);
  const categoryHref = (districtId: CapabilityDistrictId) =>
    buildFrontendHref(`/capability/${districtId}`, {
      themeId,
      projectId,
      query: { view: CAPABILITY_DISTRICT_DEFAULT_VIEWS[districtId] },
    });
  const content = useCapabilitySpaceController({
    selection,
    onSelectDistrict: (districtId) => navigate(categoryHref(districtId)),
    onSelectObject: (object: CapabilityObjectRecord) =>
      navigate(buildFrontendHref(capabilityObjectPath(object), { themeId, projectId })),
    onProviderCreated: (providerId) =>
      navigate(
        buildFrontendHref(`/capability/providers/profile/${encodeURIComponent(providerId)}`, {
          themeId,
          projectId,
        }),
      ),
    onReturnOverview: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
  });

  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function CapabilityObjectWorkbenchRoute() {
  const location = useLocation();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("capability");
  const selection = parseCapabilityPath(location.pathname);

  if (!selection.districtId || !selection.kind) {
    return (
      <Navigate
        replace
        to={buildFrontendHref(space.route, {
          themeId,
          projectId,
        })}
      />
    );
  }

  return (
    <LoadedCapabilityObjectWorkbenchRoute
      Page={theme.SpacePage}
      space={space}
      themeId={themeId}
      projectId={projectId}
      pathname={location.pathname}
    />
  );
}

function isCapabilityDownloadCategoryId(
  value: string | undefined,
): value is CapabilityDownloadCategoryId {
  return value === "taggers" || value === "dictionaries";
}

interface LoadedCapabilityDownloadWorkbenchRouteProps extends CapabilityRouteProps {
  categoryId: CapabilityDownloadCategoryId;
}

function LoadedCapabilityDownloadWorkbenchRoute({
  Page,
  space,
  themeId,
  projectId,
  categoryId,
}: LoadedCapabilityDownloadWorkbenchRouteProps) {
  const navigate = useNavigate();
  const content = useCapabilityDownloadWorkbenchController({
    categoryId,
    onReturnCategory: () =>
      navigate(
        buildFrontendHref(`/capability/${categoryId}`, {
          themeId,
          projectId,
          query: { view: categoryId === "taggers" ? "profiles" : "installations" },
        }),
      ),
    onReturnOverview: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function CapabilityDownloadWorkbenchRoute() {
  const location = useLocation();
  const { categoryId } = useParams();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("capability");
  if (!isCapabilityDownloadCategoryId(categoryId)) {
    return <Navigate replace to={buildFrontendHref(space.route, { themeId, projectId })} />;
  }
  return (
    <LoadedCapabilityDownloadWorkbenchRoute
      Page={theme.SpacePage}
      space={space}
      themeId={themeId}
      projectId={projectId}
      categoryId={categoryId}
    />
  );
}

function isCapabilitySystemSectionId(
  value: string | undefined,
): value is CapabilitySystemSectionId {
  return value === "appearance" || value === "announcements" || value === "diagnostics";
}

interface LoadedCapabilitySystemWorkbenchRouteProps extends CapabilityRouteProps {
  sectionId: CapabilitySystemSectionId;
}

function LoadedCapabilitySystemWorkbenchRoute({
  Page,
  space,
  themeId,
  projectId,
  sectionId,
}: LoadedCapabilitySystemWorkbenchRouteProps) {
  const navigate = useNavigate();
  const systemSectionHref = (nextSectionId: CapabilitySystemSectionId) =>
    buildFrontendHref("/capability/system", {
      themeId,
      projectId,
      query: { view: nextSectionId },
    });
  const content = useCapabilitySystemWorkbenchController({
    sectionId,
    themeId,
    onSelectSection: (nextSectionId) => navigate(systemSectionHref(nextSectionId)),
    onReturnCategory: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
    onReturnOverview: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function CapabilitySystemWorkbenchRoute() {
  const location = useLocation();
  const { sectionId } = useParams();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("capability");
  const requestedSectionId =
    sectionId ?? readRouteIdentifier(location.search, "view") ?? "appearance";
  if (sectionId && isCapabilitySystemSectionId(sectionId)) {
    return (
      <Navigate
        replace
        to={buildFrontendHref("/capability/system", {
          themeId,
          projectId,
          query: { view: sectionId },
        })}
      />
    );
  }
  const resolvedSectionId = isCapabilitySystemSectionId(requestedSectionId)
    ? requestedSectionId
    : "appearance";
  return (
    <LoadedCapabilitySystemWorkbenchRoute
      Page={theme.SpacePage}
      space={space}
      themeId={themeId}
      projectId={projectId}
      sectionId={resolvedSectionId}
    />
  );
}

function ArchiveRoute({ Page, space, themeId, projectId, onProjectIdChange }: ArchiveRouteProps) {
  const navigate = useNavigate();
  const content = useArchiveSpaceController({
    activeProjectId: projectId,
    onActiveProjectChange: onProjectIdChange,
    onOpenProjectWorkbench: (nextProjectId) =>
      navigate(
        buildFrontendHref("/annotation/stage", {
          themeId,
          projectId: nextProjectId,
        }),
      ),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

interface PreparationRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string | null;
}

function PreparationRoute({ Page, space, themeId, projectId }: PreparationRouteProps) {
  const navigate = useNavigate();
  const content = usePreparationSpaceController({
    projectId,
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
    onOpenWorkbench: (focus?: PreparationCapabilityId) =>
      navigate(
        buildFrontendHref("/preparation/workbench", {
          themeId,
          projectId,
          query: { focus },
        }),
      ),
    onOpenOperation: (operationId, focus) =>
      navigate(
        buildFrontendHref("/preparation/workbench", {
          themeId,
          projectId,
          query: { focus, operation: operationId },
        }),
      ),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

interface AnnotationRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string | null;
}

function AnnotationRoute({ Page, space, themeId, projectId }: AnnotationRouteProps) {
  const navigate = useNavigate();
  const content = useAnnotationSpaceController({
    projectId,
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
    onOpenWorkbench: (assetId?: string, lane?: AnnotationLaneId) =>
      navigate(
        buildFrontendHref("/annotation/stage", {
          themeId,
          projectId,
          query: { asset: assetId, channel: lane },
        }),
      ),
    onOpenProduction: (lane?: AnnotationLaneId, operationId?: string) =>
      navigate(
        buildFrontendHref("/annotation/stage/production", {
          themeId,
          projectId,
          query: { lane, operation: operationId },
        }),
      ),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

interface QualityQuery {
  assetId: string | null;
  filter: QualityFilterId | null;
  channel: AnnotationLaneId | null;
}

function readQualityQuery(search: string): QualityQuery {
  const filter = readRouteIdentifier(search, "filter");
  const channel = readRouteIdentifier(search, "channel");
  return {
    assetId: readRouteIdentifier(search, "asset"),
    filter: isQualityFilterId(filter) ? filter : null,
    channel: isAnnotationLaneId(channel) ? channel : null,
  };
}

interface LoadedQualityRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string;
  query: QualityQuery;
}

function LoadedQualityRoute({ Page, space, themeId, projectId, query }: LoadedQualityRouteProps) {
  const navigate = useNavigate();
  const qualityHref = (overrides: Partial<QualityQuery>) => {
    const next = { ...query, ...overrides };
    return buildFrontendHref(space.route, {
      themeId,
      projectId,
      query: { asset: next.assetId, filter: next.filter, channel: next.channel },
    });
  };
  const content = useQualitySpaceController({
    projectId,
    requestedAssetId: query.assetId,
    requestedFilter: query.filter,
    requestedChannel: query.channel,
    onAssetIdChange: (assetId) => navigate(qualityHref({ assetId }), { replace: true }),
    onFilterChange: (filter) => navigate(qualityHref({ assetId: null, filter }), { replace: true }),
    onChannelChange: (channel) => navigate(qualityHref({ channel }), { replace: true }),
    onOpenReview: (assetId, filter, channel) =>
      navigate(
        buildFrontendHref("/quality/review", {
          themeId,
          projectId,
          query: { asset: assetId, filter, channel },
        }),
      ),
    onOpenAnnotation: (assetId, channel) =>
      navigate(
        buildFrontendHref("/annotation/stage/edit", {
          themeId,
          projectId,
          query: { asset: assetId, channel },
        }),
      ),
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
    onOpenDelivery: () =>
      navigate(buildFrontendHref(getHomeSpace("delivery").route, { themeId, projectId })),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

interface QualityRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string | null;
}

function QualityRoute({ Page, space, themeId, projectId }: QualityRouteProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const query = readQualityQuery(location.search);

  if (projectId) {
    return (
      <LoadedQualityRoute
        Page={Page}
        space={space}
        themeId={themeId}
        projectId={projectId}
        query={query}
      />
    );
  }

  const content = createNoContextQualitySpace({
    onOpenArchive: () => navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId })),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={null}
    />
  );
}

interface DeliveryRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string | null;
}

function DeliveryRoute({ Page, space, themeId, projectId }: DeliveryRouteProps) {
  const navigate = useNavigate();
  const content = useDeliverySpaceController({
    projectId,
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
    onOpenQuality: (filter) =>
      navigate(
        buildFrontendHref(getHomeSpace("quality").route, {
          themeId,
          projectId,
          query: { filter },
        }),
      ),
    onOpenWorkbench: (operationId) =>
      navigate(
        buildFrontendHref("/delivery/workbench", {
          themeId,
          projectId,
          query: { operation: operationId },
        }),
      ),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function SpaceRoute() {
  const location = useLocation();
  const { spaceId = "" } = useParams();
  const { projectId, setProjectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpaceByRoute(`/${spaceId}`);

  if (!space) {
    return <Navigate replace to={buildFrontendHref("/", { themeId, projectId })} />;
  }
  if (space.id === "archive") {
    return (
      <ArchiveRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
        onProjectIdChange={setProjectId}
      />
    );
  }
  if (space.id === "preparation") {
    return (
      <PreparationRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
      />
    );
  }
  if (space.id === "annotation") {
    return (
      <AnnotationRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
      />
    );
  }
  if (space.id === "quality") {
    return (
      <QualityRoute Page={theme.SpacePage} space={space} themeId={themeId} projectId={projectId} />
    );
  }
  if (space.id === "delivery") {
    return (
      <DeliveryRoute Page={theme.SpacePage} space={space} themeId={themeId} projectId={projectId} />
    );
  }
  if (space.id === "capability") {
    return (
      <CapabilityRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
      />
    );
  }
  return (
    <SpaceRouteView
      Page={theme.SpacePage}
      space={space}
      content={{ kind: "pending" }}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

interface AnnotationStageQuery {
  assetId: string | null;
  workcell: AnnotationWorkcellId | null;
  lane: AnnotationLaneId | null;
  channel: AnnotationEditChannelId | null;
  dossierSection: AnnotationDossierSectionId | null;
  operationId: string | null;
}

function annotationStagePath(workcell: AnnotationWorkcellId | null): string {
  return workcell ? `/annotation/stage/${workcell}` : "/annotation/stage";
}

function readAnnotationStageQuery(
  search: string,
  routeWorkcell: AnnotationWorkcellId | null = null,
): AnnotationStageQuery {
  const focus = readRouteIdentifier(search, "focus");
  const lane = readRouteIdentifier(search, "lane");
  const channel = readRouteIdentifier(search, "channel");
  const section = readRouteIdentifier(search, "section");
  return {
    assetId: readRouteIdentifier(search, "asset"),
    workcell: routeWorkcell ?? (isAnnotationWorkcellId(focus) ? focus : null),
    lane: isAnnotationLaneId(lane) ? lane : null,
    channel: isAnnotationEditChannelId(channel) ? channel : null,
    dossierSection: ANNOTATION_DOSSIER_SECTION_IDS.includes(section as AnnotationDossierSectionId)
      ? (section as AnnotationDossierSectionId)
      : null,
    operationId: readRouteIdentifier(search, "operation"),
  };
}

interface LoadedAnnotationStageRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string;
  query: AnnotationStageQuery;
}

function LoadedAnnotationStageRoute({
  Page,
  space,
  themeId,
  projectId,
  query,
}: LoadedAnnotationStageRouteProps) {
  const navigate = useNavigate();
  const stageHref = (overrides: Partial<AnnotationStageQuery>) => {
    const next = { ...query, ...overrides };
    return buildFrontendHref(annotationStagePath(next.workcell), {
      themeId,
      projectId,
      query: {
        asset: next.assetId,
        lane: next.lane,
        channel: next.channel,
        section: next.dossierSection,
        operation: next.operationId,
      },
    });
  };
  const content = useAnnotationStageController({
    projectId,
    requestedAssetId: query.assetId,
    requestedOperationId: query.operationId,
    activeWorkcell: query.workcell,
    requestedEditChannel: query.channel,
    requestedDossierSection: query.dossierSection,
    requestedProductionLane: query.lane,
    onAssetIdChange: (assetId) => navigate(stageHref({ assetId }), { replace: true }),
    onOpenWorkcell: (workcell) => navigate(stageHref({ workcell })),
    onCloseWorkcell: () => navigate(stageHref({ workcell: null })),
    onEditChannelChange: (channel) => navigate(stageHref({ workcell: "edit", channel })),
    onDossierSectionChange: (dossierSection) =>
      navigate(stageHref({ workcell: "dossier", dossierSection }), { replace: true }),
    onProductionLaneChange: (lane) =>
      navigate(stageHref({ workcell: "production", lane, operationId: null }), { replace: true }),
    onProductionOperationChange: (operationId) =>
      navigate(stageHref({ workcell: "production", operationId })),
    onReturnToSpace: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
    onOpenQuality: () =>
      navigate(
        buildFrontendHref(getHomeSpace("quality").route, {
          themeId,
          projectId,
          query: { asset: query.assetId },
        }),
      ),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

interface AnnotationStageRouteProps {
  workcell?: AnnotationWorkcellId;
}

function AnnotationStageRoute({ workcell = undefined }: AnnotationStageRouteProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("annotation");
  const query = readAnnotationStageQuery(location.search, workcell ?? null);

  if (!workcell && query.workcell) {
    return (
      <Navigate
        replace
        to={buildFrontendHref(annotationStagePath(query.workcell), {
          themeId,
          projectId,
          query: {
            asset: query.assetId,
            lane: query.lane,
            channel: query.channel,
            section: query.dossierSection,
            operation: query.operationId,
          },
        })}
      />
    );
  }
  if (projectId) {
    return (
      <LoadedAnnotationStageRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
        query={query}
      />
    );
  }

  const content = createNoContextAnnotationStage({
    onReturnToSpace: () => navigate(buildFrontendHref(space.route, { themeId })),
    onOpenArchive: () => navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId })),
  });
  return (
    <SpaceRouteView
      Page={theme.SpacePage}
      space={space}
      content={content}
      themeId={themeId}
      projectId={null}
    />
  );
}

interface LegacyAnnotationRedirectProps {
  focus?: AnnotationWorkcellId;
}

function LegacyAnnotationRedirect({ focus }: LegacyAnnotationRedirectProps) {
  const location = useLocation();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const query = readAnnotationStageQuery(location.search);
  return (
    <Navigate
      replace
      to={buildFrontendHref(annotationStagePath(focus ?? query.workcell), {
        themeId,
        projectId,
        query: {
          asset: query.assetId,
          lane: query.lane,
          channel: query.channel,
          section: query.dossierSection,
          operation: query.operationId,
        },
      })}
    />
  );
}

interface LoadedQualityReviewRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string;
  query: QualityQuery;
}

function LoadedQualityReviewRoute({
  Page,
  space,
  themeId,
  projectId,
  query,
}: LoadedQualityReviewRouteProps) {
  const navigate = useNavigate();
  const filter = query.filter ?? "needs_review";
  const channel = query.channel ?? "tags";
  const reviewHref = (overrides: Partial<QualityQuery>) => {
    const next = { ...query, filter, channel, ...overrides };
    return buildFrontendHref("/quality/review", {
      themeId,
      projectId,
      query: { asset: next.assetId, filter: next.filter, channel: next.channel },
    });
  };
  const content = useQualityReviewController({
    projectId,
    requestedAssetId: query.assetId,
    filter,
    channel,
    onAssetIdChange: (assetId) => navigate(reviewHref({ assetId }), { replace: true }),
    onChannelChange: (nextChannel) =>
      navigate(reviewHref({ channel: nextChannel }), { replace: true }),
    onReturnToQuality: (assetId, nextFilter, nextChannel) =>
      navigate(
        buildFrontendHref(space.route, {
          themeId,
          projectId,
          query: { asset: assetId, filter: nextFilter, channel: nextChannel },
        }),
      ),
    onOpenAnnotation: (assetId, nextChannel) =>
      navigate(
        buildFrontendHref("/annotation/stage/edit", {
          themeId,
          projectId,
          query: { asset: assetId, channel: nextChannel },
        }),
      ),
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function QualityReviewRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("quality");
  const query = readQualityQuery(location.search);
  const filter = query.filter ?? "needs_review";
  const channel = query.channel ?? "tags";

  if (projectId) {
    return (
      <LoadedQualityReviewRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
        query={query}
      />
    );
  }

  const content = createNoContextQualityReview({
    filter,
    channel,
    onReturnToQuality: () => navigate(buildFrontendHref(space.route, { themeId })),
    onOpenArchive: () => navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId })),
  });
  return (
    <SpaceRouteView
      Page={theme.SpacePage}
      space={space}
      content={content}
      themeId={themeId}
      projectId={null}
    />
  );
}

interface LoadedPreparationWorkbenchRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string;
  initialFocus: PreparationCanvasNodeId;
  initialOperationId: string | null;
}

function LoadedPreparationWorkbenchRoute({
  Page,
  space,
  themeId,
  projectId,
  initialFocus,
  initialOperationId,
}: LoadedPreparationWorkbenchRouteProps) {
  const navigate = useNavigate();
  const content = usePreparationWorkbenchController({
    projectId,
    initialFocus,
    initialOperationId,
    onOperationIdChange: (operationId) =>
      navigate(
        buildFrontendHref("/preparation/workbench", {
          themeId,
          projectId,
          query: {
            focus: operationId
              ? initialFocus === "source"
                ? null
                : initialFocus
              : isPreparationCapabilityId(initialFocus)
                ? initialFocus
                : null,
            operation: operationId,
          },
        }),
        { replace: true },
      ),
    onReturnToSpace: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
    onOpenAnnotationStage: () =>
      navigate(buildFrontendHref("/annotation/stage", { themeId, projectId })),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function PreparationWorkbenchRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("preparation");
  const requestedFocus = new URLSearchParams(location.search).get("focus");
  const initialFocus: PreparationCanvasNodeId = isPreparationCanvasNodeId(requestedFocus)
    ? requestedFocus
    : "scope";
  const initialOperationId = readRouteIdentifier(location.search, "operation");

  if (projectId) {
    return (
      <LoadedPreparationWorkbenchRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
        initialFocus={initialFocus}
        initialOperationId={initialOperationId}
      />
    );
  }

  const content = createNoContextPreparationWorkbench({
    initialFocus,
    onReturnToSpace: () => navigate(buildFrontendHref(space.route, { themeId })),
    onOpenArchive: () => navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId })),
    onOpenAnnotationStage: () => navigate(buildFrontendHref("/annotation/stage", { themeId })),
  });
  return (
    <SpaceRouteView
      Page={theme.SpacePage}
      space={space}
      content={content}
      themeId={themeId}
      projectId={null}
    />
  );
}

interface LoadedDeliveryWorkbenchRouteProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  themeId: string;
  projectId: string;
  initialOperationId: string | null;
}

function LoadedDeliveryWorkbenchRoute({
  Page,
  space,
  themeId,
  projectId,
  initialOperationId,
}: LoadedDeliveryWorkbenchRouteProps) {
  const navigate = useNavigate();
  const content = useDeliveryWorkbenchController({
    projectId,
    initialOperationId,
    onOperationIdChange: (operationId) =>
      navigate(
        buildFrontendHref("/delivery/workbench", {
          themeId,
          projectId,
          query: { operation: operationId },
        }),
        { replace: true },
      ),
    onReturnToSpace: () => navigate(buildFrontendHref(space.route, { themeId, projectId })),
    onOpenQuality: (filter) =>
      navigate(
        buildFrontendHref(getHomeSpace("quality").route, {
          themeId,
          projectId,
          query: { filter },
        }),
      ),
    onOpenArchive: () =>
      navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId, projectId })),
  });
  return (
    <SpaceRouteView
      Page={Page}
      space={space}
      content={content}
      themeId={themeId}
      projectId={projectId}
    />
  );
}

function DeliveryWorkbenchRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpace("delivery");
  const initialOperationId = readRouteIdentifier(location.search, "operation");

  if (projectId) {
    return (
      <LoadedDeliveryWorkbenchRoute
        Page={theme.SpacePage}
        space={space}
        themeId={themeId}
        projectId={projectId}
        initialOperationId={initialOperationId}
      />
    );
  }

  const content = createNoContextDeliveryWorkbench({
    onReturnToSpace: () => navigate(buildFrontendHref(space.route, { themeId })),
    onOpenQuality: (filter) =>
      navigate(buildFrontendHref(getHomeSpace("quality").route, { themeId, query: { filter } })),
    onOpenArchive: () => navigate(buildFrontendHref(getHomeSpace("archive").route, { themeId })),
  });
  return (
    <SpaceRouteView
      Page={theme.SpacePage}
      space={space}
      content={content}
      themeId={themeId}
      projectId={null}
    />
  );
}

function FallbackRoute() {
  const location = useLocation();
  const { projectId } = useProjectRouteContext();
  const themeId = resolveFrontendThemeId(location.search);
  return <Navigate replace to={buildFrontendHref("/", { themeId, projectId })} />;
}

export function FrontendRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/preparation/workbench" element={<PreparationWorkbenchRoute />} />
      <Route path="/annotation/stage" element={<AnnotationStageRoute />} />
      <Route path="/annotation/stage/edit" element={<AnnotationStageRoute workcell="edit" />} />
      <Route
        path="/annotation/stage/production"
        element={<AnnotationStageRoute workcell="production" />}
      />
      <Route
        path="/annotation/stage/dossier"
        element={<AnnotationStageRoute workcell="dossier" />}
      />
      <Route path="/annotation/workbench" element={<LegacyAnnotationRedirect />} />
      <Route
        path="/annotation/production"
        element={<LegacyAnnotationRedirect focus="production" />}
      />
      <Route path="/quality/review" element={<QualityReviewRoute />} />
      <Route path="/delivery/workbench" element={<DeliveryWorkbenchRoute />} />
      <Route
        path="/capability/:categoryId/downloads"
        element={<CapabilityDownloadWorkbenchRoute />}
      />
      <Route path="/capability/system" element={<CapabilitySystemWorkbenchRoute />} />
      <Route path="/capability/system/:sectionId" element={<CapabilitySystemWorkbenchRoute />} />
      <Route path="/capability/providers/new" element={<CapabilityObjectWorkbenchRoute />} />
      <Route
        path="/capability/providers/profile/:resourceId"
        element={<CapabilityObjectWorkbenchRoute />}
      />
      <Route path="/capability/taggers/runtime" element={<CapabilityObjectWorkbenchRoute />} />
      <Route
        path="/capability/taggers/installation/:resourceId"
        element={<CapabilityObjectWorkbenchRoute />}
      />
      <Route
        path="/capability/taggers/profile/:resourceId"
        element={<CapabilityObjectWorkbenchRoute />}
      />
      <Route
        path="/capability/dictionaries/installation/:resourceId"
        element={<CapabilityObjectWorkbenchRoute />}
      />
      <Route
        path="/capability/dictionaries/overrides"
        element={<CapabilityObjectWorkbenchRoute />}
      />
      <Route
        path="/capability/prompts/system/:resourceId"
        element={<CapabilityObjectWorkbenchRoute />}
      />
      <Route
        path="/capability/prompts/translation/:resourceId"
        element={<CapabilityObjectWorkbenchRoute />}
      />
      <Route path="/capability/:categoryId" element={<CapabilityCategoryRoute />} />
      <Route path="/:spaceId" element={<SpaceRoute />} />
      <Route path="*" element={<FallbackRoute />} />
    </Routes>
  );
}
