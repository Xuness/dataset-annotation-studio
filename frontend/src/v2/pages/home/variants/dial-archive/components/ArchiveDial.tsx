import { useId, type FocusEvent, type KeyboardEvent } from "react";

import { useDialMotion } from "../hooks/useDialMotion";
import {
  DIAL_CENTER,
  DIAL_GAP_REST_ANGLE,
  DIAL_NUMBER_REST_ANGLES,
  DIAL_SEGMENT_REST_ANGLES,
  arcPath,
  degreesFrom,
  dialNumberPoint,
  polarPoint,
  readerWedgePath,
  ringSectorPath,
} from "../model/dialGeometry";
import type { DialArchiveSpace } from "../model/spacePresentation";
import { TelemetryPanel } from "./TelemetryPanel";

interface ArchiveDialProps {
  spaces: readonly DialArchiveSpace[];
  displayIndex: number;
  selectedIndex: number;
  contentIndex: number;
  reducedMotion: boolean;
  onFocusPreview(index: number | null): void;
  onCommit(index: number): void;
}

const TEN_DEGREE_TICKS = degreesFrom(10);

function SegmentEndCap({ angle }: { angle: number }) {
  const [startX, startY] = polarPoint(370, angle);
  const [endX, endY] = polarPoint(420, angle);
  return (
    <line
      x1={startX}
      y1={startY}
      x2={endX}
      y2={endY}
      stroke="#191919"
      strokeWidth="3"
      pointerEvents="none"
    />
  );
}

function FixedDialFrame() {
  const [bottomStartX, bottomStartY] = polarPoint(306, 90);
  const [bottomEndX, bottomEndY] = polarPoint(318, 90);
  const [calibrationX, calibrationY] = polarPoint(330, 100);
  const [cardinalX, cardinalY] = polarPoint(488, 90);

  return (
    <>
      <g className="dial-archive-dial__fixed-frame">
        <g stroke="#999999" strokeWidth="1" opacity="0.48">
          <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r="470" fill="none" />
          {TEN_DEGREE_TICKS.map((angle) => {
            const long = angle % 30 === 0;
            const [startX, startY] = polarPoint(long ? 448 : 460, angle);
            const [endX, endY] = polarPoint(470, angle);
            return (
              <line
                key={angle}
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                strokeWidth={long ? 1.4 : 1}
              />
            );
          })}
        </g>
        <circle
          cx={DIAL_CENTER}
          cy={DIAL_CENTER}
          r="395"
          fill="none"
          stroke="rgba(25,25,25,.055)"
          strokeWidth="46"
        />
        <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r="370" fill="none" stroke="rgba(25,25,25,.12)" />
        <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r="420" fill="none" stroke="rgba(25,25,25,.12)" />
        <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r="300" fill="none" stroke="rgba(25,25,25,.18)" />

        <g className="dial-archive-dial__core-dock">
          <circle
            cx={DIAL_CENTER}
            cy={DIAL_CENTER}
            r="230"
            fill="none"
            stroke="rgba(25,25,25,.20)"
            strokeDasharray="2 9"
          />
          <path d={arcPath(230, -112, -68)} fill="none" stroke="#191919" strokeWidth="3" />
          <path d={arcPath(230, 68, 112)} fill="none" stroke="rgba(25,25,25,.18)" />
          {[0, 90, 180, 270].map((angle) => {
            const [startX, startY] = polarPoint(220, angle);
            const [endX, endY] = polarPoint(240, angle);
            return (
              <line
                key={angle}
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke="rgba(25,25,25,.34)"
              />
            );
          })}
        </g>
      </g>
      <line
        x1={bottomStartX}
        y1={bottomStartY}
        x2={bottomEndX}
        y2={bottomEndY}
        stroke="#191919"
        strokeWidth="3"
      />
      <text
        x={calibrationX}
        y={calibrationY}
        className="dial-archive-dial__micro-code"
        textAnchor="middle"
      >
        CAL.42
      </text>
      <text
        x={cardinalX}
        y={cardinalY}
        className="dial-archive-dial__micro-code"
        textAnchor="middle"
        dominantBaseline="central"
      >
        180
      </text>
    </>
  );
}

function InnerCalibrationRotor({
  initialRotation,
  innerRotorRef,
}: {
  initialRotation: number;
  innerRotorRef: ReturnType<typeof useDialMotion>["innerRotorRef"];
}) {
  const [dotX, dotY] = polarPoint(300, 120);
  return (
    <g
      ref={innerRotorRef}
      className="dial-archive-dial__inner-rotor"
      transform={`rotate(${initialRotation} ${DIAL_CENTER} ${DIAL_CENTER})`}
    >
      <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r="328" fill="none" stroke="rgba(25,25,25,.10)" />
      {TEN_DEGREE_TICKS.map((angle) => {
        const long = angle % 30 === 0;
        const [startX, startY] = polarPoint(long ? 276 : 288, angle);
        const [endX, endY] = polarPoint(300, angle);
        return (
          <line
            key={angle}
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
            stroke="#999999"
            opacity={long ? 0.62 : 0.38}
          />
        );
      })}
      <path d={arcPath(300, 40, 95)} fill="none" stroke="#a7a7a7" strokeWidth="12" />
      <path
        d={arcPath(300, 150, 240)}
        fill="none"
        stroke="rgba(25,25,25,.34)"
        strokeWidth="4"
        strokeDasharray="10 14"
      />
      <path d={arcPath(300, 285, 313)} fill="none" stroke="#d9d9d9" strokeWidth="16" />
      <path d={arcPath(300, 0, 12)} fill="none" stroke="#fffa00" strokeWidth="8" />
      <path d={arcPath(328, 124, 174)} fill="none" stroke="#191919" strokeWidth="8" />
      <path d={arcPath(328, 258, 304)} fill="none" stroke="#b8b8b8" strokeWidth="3" />
      {[15, 200, 330].map((angle) => {
        const [startX, startY] = polarPoint(258, angle);
        const [endX, endY] = polarPoint(282, angle);
        return (
          <line
            key={angle}
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
            stroke="rgba(25,25,25,.4)"
          />
        );
      })}
      <circle cx={dotX} cy={dotY} r="4" fill="#999999" />
      {[42, 138, 222, 318].map((angle, index) => {
        const [startX, startY] = polarPoint(306, angle);
        const [endX, endY] = polarPoint(index % 2 ? 344 : 336, angle);
        return (
          <line
            key={angle}
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
            stroke={index === 3 ? "#fffa00" : "rgba(25,25,25,.42)"}
            strokeWidth={index === 3 ? 3 : 1}
          />
        );
      })}
    </g>
  );
}

function FixedReader() {
  const [triangleX, triangleY] = polarPoint(350, -85);
  const [labelX, labelY] = polarPoint(350, -79);
  const [lineStartX, lineStartY] = polarPoint(225, -90);
  const [lineEndX, lineEndY] = polarPoint(428, -90);
  return (
    <>
      <path
        d={ringSectorPath(230, 360, -102, -78)}
        fill="rgba(255,250,0,.12)"
        pointerEvents="none"
      />
      <path d={readerWedgePath()} fill="#fffa00" pointerEvents="none" />
      <polygon
        points={`${triangleX - 4},${triangleY - 3} ${triangleX + 4},${triangleY - 3} ${triangleX},${triangleY + 4}`}
        fill="#999999"
      />
      <text x={labelX} y={labelY} className="dial-archive-dial__micro-code">
        RDR
      </text>
      <line
        x1={lineStartX}
        y1={lineStartY}
        x2={lineEndX}
        y2={lineEndY}
        stroke="#191919"
        strokeWidth="2"
        pointerEvents="none"
      />
    </>
  );
}

export function ArchiveDial({
  spaces,
  displayIndex,
  selectedIndex,
  contentIndex,
  reducedMotion,
  onFocusPreview,
  onCommit,
}: ArchiveDialProps) {
  const titleId = useId();
  const motion = useDialMotion(displayIndex, reducedMotion);
  const handleFocusOut = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onFocusPreview(null);
  };
  const handleSegmentKeyDown = (event: KeyboardEvent<SVGPathElement>, index: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onCommit(index);
  };

  return (
    <>
      <TelemetryPanel motion={motion} selectedSpace={spaces[selectedIndex]} />
      <div className="dial-archive-dial-tag" aria-hidden="true">
        SYS.DIAL // 06-CH
      </div>
      <div
        className="dial-archive-dial"
        data-display-space={spaces[displayIndex].id}
        onBlur={handleFocusOut}
      >
        <svg viewBox="0 0 1000 1000" role="group" aria-labelledby={titleId}>
          <title id={titleId}>空间选择断环仪</title>
          <FixedDialFrame />
          <InnerCalibrationRotor
            initialRotation={motion.initialInnerRotation}
            innerRotorRef={motion.innerRotorRef}
          />
          <FixedReader />

          <g
            ref={motion.outerRotorRef}
            className="dial-archive-dial__selection-rotor"
            transform={`rotate(${motion.initialRotation} ${DIAL_CENTER} ${DIAL_CENTER})`}
          >
            {spaces.map((space, index) => {
              const restAngle = DIAL_SEGMENT_REST_ANGLES[index];
              return (
                <g key={space.id}>
                  <path
                    className="dial-archive-dial__segment"
                    d={arcPath(395, restAngle - 17, restAngle + 17)}
                    fill="none"
                    stroke="#191919"
                    strokeWidth="46"
                    strokeDasharray={space.separated ? "16 14" : undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={`锁定空间 ${space.index} ${space.label}`}
                    aria-pressed={selectedIndex === index}
                    data-space-id={space.id}
                    onFocus={() => onFocusPreview(index)}
                    onClick={() => onCommit(index)}
                    onKeyDown={(event) => handleSegmentKeyDown(event, index)}
                  />
                  <SegmentEndCap angle={restAngle - 17} />
                  <SegmentEndCap angle={restAngle + 17} />
                </g>
              );
            })}

            <g className="dial-archive-dial__gap-slot">
              <path
                d={arcPath(372, DIAL_GAP_REST_ANGLE - 17, DIAL_GAP_REST_ANGLE + 17)}
                fill="none"
                stroke="#999999"
                strokeWidth="1.5"
                strokeDasharray="4 6"
              />
              <path
                d={arcPath(418, DIAL_GAP_REST_ANGLE - 17, DIAL_GAP_REST_ANGLE + 17)}
                fill="none"
                stroke="#999999"
                strokeWidth="1.5"
                strokeDasharray="4 6"
              />
              {[-17, 17].map((offset) => {
                const [startX, startY] = polarPoint(372, DIAL_GAP_REST_ANGLE + offset);
                const [endX, endY] = polarPoint(418, DIAL_GAP_REST_ANGLE + offset);
                return (
                  <line
                    key={offset}
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke="#999999"
                    strokeWidth="1.5"
                    strokeDasharray="4 6"
                  />
                );
              })}
            </g>
          </g>

          <g className="dial-archive-dial__numbers" pointerEvents="none">
            {spaces.map((space, index) => {
              const [x, y] = dialNumberPoint(index, motion.initialRotation);
              return (
                <text
                  key={space.id}
                  ref={(node) => motion.setNumberRef(index, node)}
                  x={x}
                  y={y}
                  className={index === contentIndex ? "is-current" : undefined}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {space.index}
                </text>
              );
            })}
            {(() => {
              const index = DIAL_NUMBER_REST_ANGLES.length - 1;
              const [x, y] = dialNumberPoint(index, motion.initialRotation);
              return (
                <text
                  ref={(node) => motion.setNumberRef(index, node)}
                  x={x}
                  y={y}
                  className="dial-archive-dial__number-gap"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  N/C
                </text>
              );
            })()}
          </g>
        </svg>
      </div>
    </>
  );
}
