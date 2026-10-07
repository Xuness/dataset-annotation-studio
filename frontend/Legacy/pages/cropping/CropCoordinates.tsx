import { useState } from "react";

import { validateRect } from "../../../src/application/cropping/geometry";
import type { CropRect } from "../../../src/shared/api/types";

interface Props {
  rectangle: CropRect;
  width: number;
  height: number;
  disabled: boolean;
  onChange: (rect: CropRect) => void;
  onValidity: (valid: boolean) => void;
}
export function CropCoordinates({
  rectangle,
  width,
  height,
  disabled,
  onChange,
  onValidity,
}: Props) {
  const [values, setValues] = useState({
    x: String(rectangle.x),
    y: String(rectangle.y),
    width: String(rectangle.width),
    height: String(rectangle.height),
  });
  const [error, setError] = useState<string | null>(null);
  function update(field: keyof typeof values, value: string) {
    const next = { ...values, [field]: value };
    if (rectangle.ratio && (field === "width" || field === "height")) {
      const factor = rectangle.ratio.width / rectangle.ratio.height;
      if (field === "width") next.height = String(Math.max(1, Math.round(Number(value) / factor)));
      else next.width = String(Math.max(1, Math.round(Number(value) * factor)));
    }
    setValues(next);
    try {
      if (Object.values(next).some((item) => !item.trim()))
        throw new Error("所有裁剪坐标与尺寸均为必填。");
      const result = {
        x: Number(next.x),
        y: Number(next.y),
        width: Number(next.width),
        height: Number(next.height),
        ratio: rectangle.ratio,
      };
      validateRect(result, width, height);
      setError(null);
      onValidity(true);
      onChange(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      onValidity(false);
    }
  }
  return (
    <fieldset className="crop-control-group" disabled={disabled}>
      <legend>原生像素坐标与尺寸</legend>
      <div className="crop-coordinate-fields">
        {(["x", "y", "width", "height"] as const).map((field) => (
          <label className="form-field" key={field}>
            <span>{{ x: "X 坐标", y: "Y 坐标", width: "宽度", height: "高度" }[field]}</span>
            <input
              data-testid={`crop-coordinate-${field}`}
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
