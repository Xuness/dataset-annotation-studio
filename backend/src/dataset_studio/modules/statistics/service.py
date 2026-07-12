from __future__ import annotations

from pathlib import Path

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.statistics.analyzers import StatisticsAnalyzer, TagFrequencyAnalyzer
from dataset_studio.modules.statistics.models import AnnotationStatistics
from dataset_studio.modules.workspaces.service import WorkspaceService


class StatisticsService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    def tag_frequency(self, project_id: str) -> AnnotationStatistics:
        paths, _ = self._workspaces.get(project_id)
        return self._analyze(paths.database, paths.root, TagFrequencyAnalyzer())

    @staticmethod
    def _analyze(
        database_path: Path,
        root: Path,
        analyzer: StatisticsAnalyzer,
    ) -> AnnotationStatistics:
        connection = connect(database_path)
        try:
            rows = connection.execute(
                """
                SELECT annotation_relative_path
                FROM assets
                WHERE is_present = 1 AND annotation_status != 'missing'
                ORDER BY relative_path COLLATE NOCASE
                """
            ).fetchall()
        finally:
            connection.close()

        def documents():
            for row in rows:
                path = root / str(row["annotation_relative_path"])
                try:
                    yield path.read_text(encoding="utf-8")
                except (OSError, UnicodeError):
                    continue

        return analyzer.analyze(documents())
