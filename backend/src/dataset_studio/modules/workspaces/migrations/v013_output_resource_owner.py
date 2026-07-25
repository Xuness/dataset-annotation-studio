from __future__ import annotations

from dataset_studio.core.migrations import Migration

SQL = """
ALTER TABLE output_resource_leases
ADD COLUMN owner_role TEXT;

ALTER TABLE output_resource_leases
ADD COLUMN owner_instance_id TEXT;

UPDATE output_resource_leases
SET owner_role = 'legacy',
    owner_instance_id = 'legacy'
WHERE operation_id IS NOT NULL;

CREATE INDEX idx_output_resource_leases_operation_owner
ON output_resource_leases(owner_role, owner_instance_id)
WHERE operation_id IS NOT NULL;
"""

MIGRATION = Migration(version=13, name="output_resource_owner", sql=SQL)
