class StudioError(Exception):
    """Base error for user-visible application failures."""


class WorkspaceNotFoundError(StudioError):
    """Raised when a workspace is not registered or no longer exists."""


class AssetNotFoundError(StudioError):
    """Raised when an asset cannot be resolved inside its workspace."""


class PresetNotFoundError(StudioError):
    """Raised when a requested preset no longer exists."""


class JobNotFoundError(StudioError):
    """Raised when a requested annotation job no longer exists."""


class TaggerNotFoundError(StudioError):
    """Raised when a local tagger installation or profile no longer exists."""


class ResourceConflictError(ValueError):
    """Raised when a write would overwrite a newer or actively owned resource."""


class FileRollbackError(RuntimeError):
    """Raised when a failed file transaction cannot restore its prior state."""
