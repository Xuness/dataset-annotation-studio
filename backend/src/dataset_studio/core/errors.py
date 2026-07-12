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
