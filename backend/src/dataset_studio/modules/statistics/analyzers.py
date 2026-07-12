from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from typing import Protocol

from dataset_studio.modules.annotations.tag_syntax import iter_start_tag_names
from dataset_studio.modules.statistics.models import AnnotationStatistics, FrequencyBucket


class StatisticsAnalyzer(Protocol):
    analyzer_id: str

    def analyze(self, documents: Iterable[str]) -> AnnotationStatistics: ...


class TagFrequencyAnalyzer:
    analyzer_id = "tag_frequency"

    def analyze(self, documents: Iterable[str]) -> AnnotationStatistics:
        document_count = 0
        counts: Counter[str] = Counter()
        for content in documents:
            document_count += 1
            counts.update(iter_start_tag_names(content))
        total = counts.total()
        buckets = [
            FrequencyBucket(
                value=name,
                count=count,
                share=round(count / total, 6) if total else 0,
            )
            for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        ]
        return AnnotationStatistics(
            analyzer=self.analyzer_id,
            document_count=document_count,
            occurrence_count=total,
            buckets=buckets,
        )
