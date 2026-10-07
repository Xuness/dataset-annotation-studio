import { useState } from "react";
import type { CropRect } from "../../../src/shared/api/types";
import { validateRect } from "../../../src/application/cropping/geometry";
interface Props {
  rectangle: CropRect;
  width: number;
  height: number;
  disabled: boolean;
  onChange: (rect: CropRect) => void;
  onValidity: (valid: boolean) => void;
}
export function CropPosition({ rectangle, width, height, disabled, onChange, onValidity }: Props) {
  const [values, setValues] = useState({ x: String(rectangle.x), y: String(rectangle.y) });
  const [error, setError] = useState<string | null>(null);
  function update(field: "x" | "y", value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    try {
      if (!next.x.trim() || !next.y.trim()) throw new Error("位置坐标为必填整数。");
      const rect = { ...rectangle, x: Number(next.x), y: Number(next.y) };
      validateRect(rect, width, height);
      onChange(rect);
      onValidity(true);
      setError(null);
    } catch (cause) {
      onValidity(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <fieldset className="crop-control-group" disabled={disabled}>
      <legend>
        裁剪位置 · 固定 {rectangle.width} × {rectangle.height}
      </legend>
      <div className="crop-coordinate-fields">
        {(["x", "y"] as const).map((field) => (
          <label className="form-field" key={field}>
            <span>{field.toUpperCase()} 坐标</span>
            <input
              data-testid={`crop-position-${field}`}
              type="number"
              step="1"
              value={values[field]}
              onChange={(event) => update(field, event.target.value)}
            />
          </label>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
