from __future__ import annotations

from pydantic import BaseModel


class FrequencyBucket(BaseModel):
    value: str
    count: int
    share: float


class AnnotationStatistics(BaseModel):
    analyzer: str
    document_count: int
    occurrence_count: int
    buckets: list[FrequencyBucket]
