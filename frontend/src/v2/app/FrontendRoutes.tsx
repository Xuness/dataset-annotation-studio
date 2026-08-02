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
import { readInitialHomeSpaceId } from "./routeState";

function themeHref(path: string, themeId: string, initialSpace?: HomeSpace): string {
  const parameters = new URLSearchParams({ theme: themeId });
  if (initialSpace) parameters.set("s", String(Number.parseInt(initialSpace.index, 10)));
  return `${path}?${parameters.toString()}`;
}

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
  const themeId = resolveFrontendThemeId(location.search);
  const { HomePage } = getFrontendTheme(themeId);

  return (
    <ThemeFrame themeId={themeId}>
      <HomePage
        initialSpaceId={readInitialHomeSpaceId(location.search)}
        onEnterSpace={(spaceId) => navigate(themeHref(getHomeSpace(spaceId).route, themeId))}
      />
    </ThemeFrame>
  );
}

interface SpaceRouteViewProps {
  Page: LazyExoticComponent<ComponentType<ThemeSpacePageProps>>;
  space: HomeSpace;
  content: SpacePageContent;
  themeId: string;
}

function SpaceRouteView({ Page, space, content, themeId }: SpaceRouteViewProps) {
  const navigate = useNavigate();
  const navigateSpace = (spaceId: HomeSpaceId) => {
    navigate(themeHref(getHomeSpace(spaceId).route, themeId));
  };
  const returnHome = (spaceId: HomeSpaceId) => {
    navigate(themeHref("/", themeId, getHomeSpace(spaceId)));
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
}

function ArchiveRoute({ Page, space, themeId }: ArchiveRouteProps) {
  const content = useArchiveSpaceController();
  return <SpaceRouteView Page={Page} space={space} content={content} themeId={themeId} />;
}

function SpaceRoute() {
  const location = useLocation();
  const { spaceId = "" } = useParams();
  const themeId = resolveFrontendThemeId(location.search);
  const theme = getFrontendTheme(themeId);
  const space = getHomeSpaceByRoute(`/${spaceId}`);

  if (!space) return <Navigate replace to={themeHref("/", themeId)} />;
  if (space.id === "archive") {
    return <ArchiveRoute Page={theme.SpacePage} space={space} themeId={themeId} />;
  }
  return (
    <SpaceRouteView
      Page={theme.SpacePage}
      space={space}
      content={{ kind: "pending" }}
      themeId={themeId}
    />
  );
}

export function FrontendRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/:spaceId" element={<SpaceRoute />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
