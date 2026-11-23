import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { REGION_MAP } from '../../shared/regions.js';

interface DotWorldMapProps {
  regionCounts: Record<string, number>;
  selectedRegion: string | null;
  onSelectRegion: (region: string | null) => void;
}

const BASE_WIDTH = 1000;
const BASE_HEIGHT = 540;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

const LAND_POLYGONS: Array<Array<[number, number]>> = [
  [
    [7, 13], [15, 10], [28, 10], [34, 15], [30, 22], [26, 26], [22, 31],
    [19, 32], [16, 28], [13, 24], [10, 19],
  ],
  [
    [35, 6], [42, 6], [44, 11], [39, 14], [35, 11],
  ],
  [
    [24, 33], [31, 33], [38, 38], [39, 44], [34, 51], [29, 52], [27, 45], [24, 38],
  ],
  [
    [46, 13], [57, 11], [61, 16], [58, 22], [52, 24], [47, 23], [46, 18],
  ],
  [
    [46, 25], [56, 25], [62, 31], [61, 39], [56, 47], [51, 47], [48, 39], [44, 32],
  ],
  [
    [60, 12], [75, 10], [90, 12], [94, 18], [89, 25], [84, 32], [79, 38],
    [73, 35], [68, 32], [62, 28], [59, 22],
  ],
  [
    [85, 22], [91, 22], [90, 28], [85, 27],
  ],
  [
    [77, 38], [87, 39], [87, 42], [77, 42],
  ],
  [
    [80, 42], [91, 42], [93, 48], [86, 50], [79, 47],
  ],
  [
    [93, 47], [97, 47], [96, 51], [93, 50],
  ],
];

interface LabelPlacement {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function clampCenter(x: number, y: number, zoom: number): { x: number; y: number } {
  const halfWidth = BASE_WIDTH / (2 * zoom);
  const halfHeight = BASE_HEIGHT / (2 * zoom);
  return {
    x: Math.min(BASE_WIDTH - halfWidth, Math.max(halfWidth, x)),
    y: Math.min(BASE_HEIGHT - halfHeight, Math.max(halfHeight, y)),
  };
}

function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function DotWorldMap({
  regionCounts,
  selectedRegion,
  onSelectRegion,
}: DotWorldMapProps) {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: BASE_WIDTH / 2, y: BASE_HEIGHT / 2 });
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    centerX: number;
    centerY: number;
  } | null>(null);
  const lastDragAtRef = useRef(0);

  const dots = useMemo(() => {
    const out: Array<{ x: number; y: number }> = [];
    for (let gx = 2; gx <= 98; gx += 1.65) {
      for (let gy = 5; gy <= 52; gy += 1.65) {
        if (LAND_POLYGONS.some((poly) => pointInPolygon(gx, gy, poly))) {
          out.push({ x: gx * 10, y: gy * 10 });
        }
      }
    }
    return out;
  }, []);

  const activeRegions = useMemo(() => {
    return Object.entries(regionCounts)
      .filter(([code, count]) => count > 0 && code !== 'OTHER' && REGION_MAP[code])
      .map(([code, count]) => ({
        meta: REGION_MAP[code],
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [regionCounts]);

  const viewport = useMemo(() => {
    const safeCenter = clampCenter(center.x, center.y, zoom);
    const width = BASE_WIDTH / zoom;
    const height = BASE_HEIGHT / zoom;
    return {
      centerX: safeCenter.x,
      centerY: safeCenter.y,
      width,
      height,
      x: safeCenter.x - width / 2,
      y: safeCenter.y - height / 2,
    };
  }, [center.x, center.y, zoom]);

  const labelPlacements = useMemo(() => {
    const placements = new Map<string, LabelPlacement>();
    const boxes: LabelBox[] = [];

    for (const { meta, count } of activeRegions) {
      const isSelected = selectedRegion === meta.code;
      const chars = meta.code.length + String(count).length + 1;
      const width = (chars * 6.8 + 8) / zoom;
      const height = 13 / zoom;
      const cx = meta.x * 10;
      const cy = meta.y * 10;
      const candidates: Array<{ placement: LabelPlacement; box: LabelBox }> = [
        {
          placement: { x: cx + 9 / zoom, y: cy - 2 / zoom, anchor: 'start' },
          box: { x: cx + 9 / zoom, y: cy - 12 / zoom, width, height },
        },
        {
          placement: { x: cx - 9 / zoom, y: cy - 2 / zoom, anchor: 'end' },
          box: { x: cx - 9 / zoom - width, y: cy - 12 / zoom, width, height },
        },
        {
          placement: { x: cx, y: cy - 13 / zoom, anchor: 'middle' },
          box: { x: cx - width / 2, y: cy - 23 / zoom, width, height },
        },
        {
          placement: { x: cx, y: cy + 17 / zoom, anchor: 'middle' },
          box: { x: cx - width / 2, y: cy + 7 / zoom, width, height },
        },
      ];
      if (cx > 880) {
        candidates.unshift(candidates.splice(1, 1)[0]);
      } else if (cx < 120) {
        candidates.unshift(candidates.splice(1, 1)[0]);
      }
      const choice = candidates.find(
        (candidate) =>
          !boxes.some((box) => boxesOverlap(candidate.box, box)) || isSelected,
      );
      if (!choice) continue;
      placements.set(meta.code, choice.placement);
      boxes.push(choice.box);
    }
    return { placements };
  }, [activeRegions, selectedRegion, zoom]);

  function applyZoom(nextZoom: number, focusX = viewport.centerX, focusY = viewport.centerY) {
    const target = clampZoom(nextZoom);
    if (target === zoom) return;
    const nextCenterX = focusX + (viewport.centerX - focusX) * (zoom / target);
    const nextCenterY = focusY + (viewport.centerY - focusY) * (zoom / target);
    setZoom(target);
    setCenter(clampCenter(nextCenterX, nextCenterY, target));
  }

  function resetView() {
    setZoom(1);
    setCenter({ x: BASE_WIDTH / 2, y: BASE_HEIGHT / 2 });
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const fractionX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const fractionY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const focusX = viewport.x + fractionX * viewport.width;
      const focusY = viewport.y + fractionY * viewport.height;
      const target = clampZoom(zoom * (event.deltaY < 0 ? 1.2 : 0.84));
      if (target === zoom) return;
      const nextCenterX = focusX + (viewport.centerX - focusX) * (zoom / target);
      const nextCenterY = focusY + (viewport.centerY - focusY) * (zoom / target);
      setZoom(target);
      setCenter(clampCenter(nextCenterX, nextCenterY, target));
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [viewport, zoom]);

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (zoom <= 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerX: viewport.centerX,
      centerY: viewport.centerY,
    };
    setDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const deltaX = ((event.clientX - drag.startX) * (BASE_WIDTH / rect.width)) / zoom;
    const deltaY = ((event.clientY - drag.startY) * (BASE_HEIGHT / rect.height)) / zoom;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) {
      lastDragAtRef.current = Date.now();
    }
    setCenter(clampCenter(drag.centerX - deltaX, drag.centerY - deltaY, zoom));
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  function handleRegionClick(code: string) {
    if (Date.now() - lastDragAtRef.current < 180) return;
    onSelectRegion(selectedRegion === code ? null : code);
  }

  const scale = 1 / zoom;

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] dark:border-[#242429] dark:bg-[#141417]">
      <svg
        ref={svgRef}
        viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        className={`block h-[280px] w-full select-none sm:h-[360px] ${
          zoom > 1 ? 'touch-none' : ''
        } ${
          zoom > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
        role="img"
        aria-label="全球节点离线点阵分布图，支持滚轮缩放与拖拽平移"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <g
          className="stroke-[#E5E7EB] dark:stroke-[#202026]"
          strokeWidth="0.7"
          opacity="0.65"
          vectorEffect="non-scaling-stroke"
        >
          <line x1="0" y1="135" x2="1000" y2="135" strokeDasharray="3 4" />
          <line x1="0" y1="270" x2="1000" y2="270" strokeDasharray="3 4" />
          <line x1="0" y1="405" x2="1000" y2="405" strokeDasharray="3 4" />
          <line x1="250" y1="0" x2="250" y2="540" strokeDasharray="3 4" />
          <line x1="500" y1="0" x2="500" y2="540" strokeDasharray="3 4" />
          <line x1="750" y1="0" x2="750" y2="540" strokeDasharray="3 4" />
        </g>

        <g className="fill-[#D4D4D8] dark:fill-[#2D2D35]">
          {dots.map((dot, idx) => (
            <circle key={idx} cx={dot.x} cy={dot.y} r={2.2 * scale} />
          ))}
        </g>

        {activeRegions.map(({ meta, count }) => {
          const cx = meta.x * 10;
          const cy = meta.y * 10;
          const isSelected = selectedRegion === meta.code;
          const isDimmed = selectedRegion !== null && !isSelected;
          const placement = labelPlacements.placements.get(meta.code);
          return (
            <g
              key={meta.code}
              className="cursor-pointer transition-opacity"
              opacity={isDimmed ? 0.35 : 1}
              onClick={() => handleRegionClick(meta.code)}
            >
              <title>
                {meta.flag} {meta.nameZh} ({meta.code}) · {count} 节点
              </title>
              <circle
                cx={cx}
                cy={cy}
                r={(isSelected ? 18 : 12) * scale}
                className="fill-[#EA580C]/15 dark:fill-[#F97316]/20"
                stroke={isSelected ? '#EA580C' : 'none'}
                strokeWidth={(isSelected ? 1.5 : 0) * scale}
              />
              <circle
                cx={cx}
                cy={cy}
                r={(isSelected ? 5.5 : 4.2) * scale}
                className="fill-[#EA580C] dark:fill-[#F97316]"
              />
              {placement && (
                <text
                  x={placement.x}
                  y={placement.y}
                  textAnchor={placement.anchor}
                  fontSize={11 * scale}
                  fontWeight="600"
                  className="pointer-events-none fill-[#0A0A0A] select-none dark:fill-[#FAFAFA]"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                >
                  {meta.code} {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded border border-[#E5E7EB] bg-[#FFFFFF]/95 p-0.5 shadow-sm backdrop-blur dark:border-[#242429] dark:bg-[#0A0A0B]/95">
        <button
          type="button"
          onClick={() => applyZoom(zoom / 1.35)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="缩小地图"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[#0A0A0A] transition-colors hover:bg-[#F7F7F8] disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#FAFAFA] dark:hover:bg-[#1C1C21]"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="tabular-mono w-10 text-center text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => applyZoom(zoom * 1.35)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="放大地图"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[#0A0A0A] transition-colors hover:bg-[#F7F7F8] disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#FAFAFA] dark:hover:bg-[#1C1C21]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={resetView}
          disabled={zoom === 1}
          aria-label="重置地图视图"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[#6B7280] transition-colors hover:bg-[#F7F7F8] hover:text-[#0A0A0A] disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#9CA3AF] dark:hover:bg-[#1C1C21] dark:hover:text-[#FAFAFA]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] bg-[#FFFFFF]/80 px-3 py-2 text-[11px] text-[#6B7280] dark:border-[#242429] dark:bg-[#0A0A0B]/80 dark:text-[#9CA3AF]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#EA580C] dark:bg-[#F97316]" />
            活跃地区信号点（点击即可筛选节点）
          </span>
          <span className="hidden text-[#9CA3AF] sm:inline">
            离线矢量点阵 · 滚轮缩放 · 拖拽平移 · 零外部地图请求
          </span>
        </div>
        {selectedRegion ? (
          <button
            type="button"
            onClick={() => onSelectRegion(null)}
            className="tabular-mono font-medium text-[#EA580C] hover:underline dark:text-[#F97316]"
          >
            清除地区筛选 ({selectedRegion})
          </button>
        ) : (
          <span className="tabular-mono">覆盖 {activeRegions.length} 个地区</span>
        )}
      </div>
    </div>
  );
}
