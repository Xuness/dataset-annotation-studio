export interface FrequencyBucket {
  value: string;
  count: number;
  share: number;
}

export interface AnnotationStatistics {
  analyzer: string;
  document_count: number;
  occurrence_count: number;
  buckets: FrequencyBucket[];
}
