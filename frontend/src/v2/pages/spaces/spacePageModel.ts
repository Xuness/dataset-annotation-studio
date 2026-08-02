import type { HomeSpace } from "../../navigation/spaceRegistry";

export interface ArchiveProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  exists: boolean;
  assetCount: number;
  annotatedCount: number;
  invalidCount: number;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface ArchiveSpaceContent {
  kind: "archive";
  status: "loading" | "ready" | "error";
  projects: readonly ArchiveProjectRecord[];
  activeProjectId: string | null;
  message: string | null;
  registering: boolean;
  removingProjectId: string | null;
  registerProject(): Promise<string | null>;
  loadProject(projectId: string): void;
  revealProject(projectId: string): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  clearMessage(): void;
}

export interface PendingSpaceContent {
  kind: "pending";
}

export type SpacePageContent = ArchiveSpaceContent | PendingSpaceContent;

export interface SpacePageFrame {
  space: HomeSpace;
  content: SpacePageContent;
}
