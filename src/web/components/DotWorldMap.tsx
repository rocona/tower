import { useMemo } from 'react';
import { REGION_MAP } from '../../shared/regions.js';

interface DotWorldMapProps {
  regionCounts: Record<string, number>;
  selectedRegion: string | null;
  onSelectRegion: (region: string | null) => void;
}

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

export function DotWorldMap({
  regionCounts,
  selectedRegion,
  onSelectRegion,
}: DotWorldMapProps) {
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

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#F7F7F8] dark:border-[#242429] dark:bg-[#141417]">
      <svg
        viewBox="0 0 1000 540"
        className="block h-[220px] w-full sm:h-[260px]"
        role="img"
        aria-label="全球节点离线点阵分布图"
      >
        <g className="stroke-[#E5E7EB] dark:stroke-[#202026]" strokeWidth="0.7" opacity="0.65">
          <line x1="0" y1="135" x2="1000" y2="135" strokeDasharray="3 4" />
          <line x1="0" y1="270" x2="1000" y2="270" strokeDasharray="3 4" />
          <line x1="0" y1="405" x2="1000" y2="405" strokeDasharray="3 4" />
          <line x1="250" y1="0" x2="250" y2="540" strokeDasharray="3 4" />
          <line x1="500" y1="0" x2="500" y2="540" strokeDasharray="3 4" />
          <line x1="750" y1="0" x2="750" y2="540" strokeDasharray="3 4" />
        </g>

        <g className="fill-[#D4D4D8] dark:fill-[#2D2D35]">
          {dots.map((d, idx) => (
            <circle key={idx} cx={d.x} cy={d.y} r="2.2" />
          ))}
        </g>

        {activeRegions.map(({ meta, count }) => {
          const cx = meta.x * 10;
          const cy = meta.y * 10;
          const isSelected = selectedRegion === meta.code;
          const isDimmed = selectedRegion !== null && !isSelected;
          return (
            <g
              key={meta.code}
              className="cursor-pointer transition-opacity"
              opacity={isDimmed ? 0.35 : 1}
              onClick={() => onSelectRegion(isSelected ? null : meta.code)}
            >
              <title>
                {meta.flag} {meta.nameZh} ({meta.code}) · {count} 节点
              </title>
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 18 : 12}
                className="fill-[#EA580C]/15 dark:fill-[#F97316]/20"
                stroke={isSelected ? '#EA580C' : 'none'}
                strokeWidth={isSelected ? 1.5 : 0}
              />
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 5.5 : 4.2}
                className="fill-[#EA580C] dark:fill-[#F97316]"
              />
              <text
                x={cx + 8}
                y={cy - 6}
                fontSize="11"
                fontWeight="600"
                className="fill-[#0A0A0A] dark:fill-[#FAFAFA] select-none"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              >
                {meta.code} {count}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] bg-[#FFFFFF]/80 px-3 py-2 text-[11px] text-[#6B7280] dark:border-[#242429] dark:bg-[#0A0A0B]/80 dark:text-[#9CA3AF]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-[#EA580C] dark:bg-[#F97316]" />
            活跃地区信号点（点击即可筛选节点）
          </span>
          <span className="hidden sm:inline text-[#9CA3AF]">离线矢量点阵 · 零外部地图请求</span>
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
