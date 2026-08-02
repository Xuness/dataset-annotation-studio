import type { ComponentType } from "react";

import type { HomeSpace, HomeSpaceId } from "../navigation/spaceRegistry";
import type { SpacePageContent } from "../pages/spaces/spacePageModel";

export interface ThemeHomePageProps {
  initialSpaceId?: HomeSpaceId;
  onEnterSpace(spaceId: HomeSpaceId): void;
}

export interface ThemeSpacePageProps {
  space: HomeSpace;
  content: SpacePageContent;
  onNavigateSpace(spaceId: HomeSpaceId): void;
  onReturnHome(spaceId: HomeSpaceId): void;
}

export interface FrontendThemeModule {
  HomePage: ComponentType<ThemeHomePageProps>;
  SpacePage: ComponentType<ThemeSpacePageProps>;
}
