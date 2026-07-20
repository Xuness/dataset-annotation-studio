import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useClipboardHistoryBridge } from "../shared/desktop/useClipboardHistoryBridge";
import { useCloseGuard } from "../shared/desktop/useCloseGuard";
import { useApplyInterfaceScale } from "../shared/desktop/useInterfaceScale";
import { DialogHost } from "../shared/ui/DialogHost";
import { Spinner } from "../shared/ui/Spinner";

const HomePage = lazy(() =>
  import("../pages/home/HomePage").then((module) => ({ default: module.HomePage })),
);
const WorkspacePage = lazy(() =>
  import("../pages/workspace/WorkspacePage").then((module) => ({
    default: module.WorkspacePage,
  })),
);
const JobsPage = lazy(() =>
  import("../pages/jobs/JobsPage").then((module) => ({ default: module.JobsPage })),
);
const PreprocessPage = lazy(() =>
  import("../pages/preprocess/PreprocessPage").then((module) => ({
    default: module.PreprocessPage,
  })),
);
const ExportPage = lazy(() =>
  import("../pages/export/ExportPage").then((module) => ({
    default: module.ExportPage,
  })),
);
const PresetsPage = lazy(() =>
  import("../pages/presets/PresetsPage").then((module) => ({
    default: module.PresetsPage,
  })),
);

export function App() {
  useClipboardHistoryBridge();
  useCloseGuard();
  useApplyInterfaceScale();
  return (
    <>
      <Suspense
        fallback={
          <div className="workspace-loading">
            <Spinner />
            <p>正在打开页面…</p>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/workspace/:projectId" element={<WorkspacePage />} />
          <Route path="/workspace/:projectId/review" element={<WorkspacePage mode="review" />} />
          <Route path="/workspace/:projectId/jobs" element={<JobsPage />} />
          <Route path="/workspace/:projectId/preprocess" element={<PreprocessPage />} />
          <Route path="/workspace/:projectId/export" element={<ExportPage />} />
          <Route path="/presets" element={<PresetsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <DialogHost />
    </>
  );
}
