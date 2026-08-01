import type { ReactNode } from "react";
import { X } from "lucide-react";

interface SettingsSectionHeaderProps {
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}

export function SettingsSectionHeader({
  eyebrow,
  title,
  description,
  actions,
  onClose,
}: SettingsSectionHeaderProps) {
  return (
    <header>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="settings-section-header__actions">
        {actions}
        <button
          type="button"
          className="settings-center__close"
          data-settings-close=""
          onClick={onClose}
          aria-label="关闭设置"
          title="关闭设置"
        >
          <X size={18} />
        </button>
      </div>
    </header>
  );
}
