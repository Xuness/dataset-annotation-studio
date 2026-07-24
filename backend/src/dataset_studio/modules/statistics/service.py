from __future__ import annotations

from dataset_studio.core.sqlite import connect
from dataset_studio.modules.statistics.models import (
    AnnotationStatistics,
    FrequencyBucket,
)
from dataset_studio.modules.workspaces.service import WorkspaceService


class StatisticsService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    def tag_frequency(self, project_id: str) -> AnnotationStatistics:
        paths, _ = self._workspaces.get(project_id)
        connection = connect(paths.database)
        try:
            document_count = int(
                connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM annotation_documents d
                    JOIN assets a ON a.id = d.asset_id
                    JOIN annotation_document_revisions r
                      ON r.id = d.confirmed_revision_id
                    WHERE a.is_present = 1
                      AND d.channel = 'tags'
                      AND d.language = ''
                      AND r.is_tombstone = 0
                      AND r.image_content_hash = a.content_hash
                    """
                ).fetchone()[0]
            )
            rows = connection.execute(
                """
                SELECT ti.name, COUNT(*) AS count
                FROM annotation_documents d
                JOIN assets a ON a.id = d.asset_id
                JOIN annotation_document_revisions r
                  ON r.id = d.confirmed_revision_id
                JOIN annotation_tag_items ti
                  ON ti.revision_id = r.id
                WHERE a.is_present = 1
                  AND d.channel = 'tags'
                  AND d.language = ''
                  AND r.is_tombstone = 0
                  AND r.image_content_hash = a.content_hash
                GROUP BY ti.normalized_name
                ORDER BY count DESC, ti.normalized_name
                """
            ).fetchall()
        finally:
            connection.close()
        total = sum(int(row["count"]) for row in rows)
        return AnnotationStatistics(
            analyzer="tag_frequency",
            document_count=document_count,
            occurrence_count=total,
            buckets=[
                FrequencyBucket(
                    value=str(row["name"]),
                    count=int(row["count"]),
                    share=round(int(row["count"]) / total, 6) if total else 0,
                )
                for row in rows
            ],
        )
