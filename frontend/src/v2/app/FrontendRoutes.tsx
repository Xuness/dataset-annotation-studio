import { Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  getHomeSpace,
  getHomeSpaceByRoute,
  type HomeSpace,
  type HomeSpaceId,
} from "../navigation/spaceRegistry";
import { useArchiveSpaceController } from "../pages/spaces/archive/useArchiveSpaceController";
import type { SpacePageContent } from "../pages/spaces/spacePageModel";
import { getFrontendTheme, resolveFrontendThemeId } from "../themes/themeRegistry";
import type { ThemeSpacePageProps } from "../themes/themeTypes";
import { buildFrontendHref, readInitialHomeSpaceId } from "./routeState";
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

function ArchiveRoute({ Page, space, themeId, projectId, onProjectIdChange }: ArchiveRouteProps) {
  const content = useArchiveSpaceController({
    activeProjectId: projectId,
    onActiveProjectChange: onProjectIdChange,
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
      <Route path="/:spaceId" element={<SpaceRoute />} />
      <Route path="*" element={<FallbackRoute />} />
    </Routes>
  );
}
