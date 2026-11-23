import type { RegionMeta } from './types.js';

export const REGIONS: RegionMeta[] = [
  { code: 'HK', nameZh: '中国香港', nameEn: 'Hong Kong', flag: '🇭🇰', x: 81.7, y: 31.8 },
  { code: 'TW', nameZh: '中国台湾', nameEn: 'Taiwan', flag: '🇹🇼', x: 83.6, y: 31.0 },
  { code: 'MO', nameZh: '中国澳门', nameEn: 'Macau', flag: '🇲🇴', x: 81.3, y: 32.0 },
  { code: 'SG', nameZh: '新加坡', nameEn: 'Singapore', flag: '🇸🇬', x: 78.8, y: 39.2 },
  { code: 'JP', nameZh: '日本', nameEn: 'Japan', flag: '🇯🇵', x: 88.2, y: 26.2 },
  { code: 'KR', nameZh: '韩国', nameEn: 'South Korea', flag: '🇰🇷', x: 85.4, y: 25.8 },
  { code: 'US', nameZh: '美国', nameEn: 'United States', flag: '🇺🇸', x: 20.5, y: 24.5 },
  { code: 'CA', nameZh: '加拿大', nameEn: 'Canada', flag: '🇨🇦', x: 22.0, y: 17.5 },
  { code: 'GB', nameZh: '英国', nameEn: 'United Kingdom', flag: '🇬🇧', x: 49.4, y: 18.8 },
  { code: 'DE', nameZh: '德国', nameEn: 'Germany', flag: '🇩🇪', x: 52.8, y: 19.6 },
  { code: 'FR', nameZh: '法国', nameEn: 'France', flag: '🇫🇷', x: 50.6, y: 21.4 },
  { code: 'NL', nameZh: '荷兰', nameEn: 'Netherlands', flag: '🇳🇱', x: 51.4, y: 18.7 },
  { code: 'CH', nameZh: '瑞士', nameEn: 'Switzerland', flag: '🇨🇭', x: 52.2, y: 21.4 },
  { code: 'IT', nameZh: '意大利', nameEn: 'Italy', flag: '🇮🇹', x: 53.5, y: 23.4 },
  { code: 'ES', nameZh: '西班牙', nameEn: 'Spain', flag: '🇪🇸', x: 48.8, y: 24.0 },
  { code: 'SE', nameZh: '瑞典', nameEn: 'Sweden', flag: '🇸🇪', x: 54.4, y: 14.8 },
  { code: 'FI', nameZh: '芬兰', nameEn: 'Finland', flag: '🇫🇮', x: 56.8, y: 14.0 },
  { code: 'NO', nameZh: '挪威', nameEn: 'Norway', flag: '🇳🇴', x: 52.5, y: 14.5 },
  { code: 'IE', nameZh: '爱尔兰', nameEn: 'Ireland', flag: '🇮🇪', x: 47.8, y: 18.8 },
  { code: 'PL', nameZh: '波兰', nameEn: 'Poland', flag: '🇵🇱', x: 55.2, y: 19.2 },
  { code: 'RU', nameZh: '俄罗斯', nameEn: 'Russia', flag: '🇷🇺', x: 64.0, y: 16.0 },
  { code: 'TR', nameZh: '土耳其', nameEn: 'Turkey', flag: '🇹🇷', x: 58.6, y: 24.4 },
  { code: 'AE', nameZh: '阿联酋', nameEn: 'UAE', flag: '🇦🇪', x: 65.2, y: 30.8 },
  { code: 'IN', nameZh: '印度', nameEn: 'India', flag: '🇮🇳', x: 71.8, y: 32.2 },
  { code: 'MY', nameZh: '马来西亚', nameEn: 'Malaysia', flag: '🇲🇾', x: 78.2, y: 38.0 },
  { code: 'TH', nameZh: '泰国', nameEn: 'Thailand', flag: '🇹🇭', x: 78.0, y: 34.4 },
  { code: 'VN', nameZh: '越南', nameEn: 'Vietnam', flag: '🇻🇳', x: 79.8, y: 34.4 },
  { code: 'PH', nameZh: '菲律宾', nameEn: 'Philippines', flag: '🇵🇭', x: 83.8, y: 34.8 },
  { code: 'ID', nameZh: '印度尼西亚', nameEn: 'Indonesia', flag: '🇮🇩', x: 80.5, y: 41.8 },
  { code: 'AU', nameZh: '澳大利亚', nameEn: 'Australia', flag: '🇦🇺', x: 87.2, y: 46.5 },
  { code: 'NZ', nameZh: '新西兰', nameEn: 'New Zealand', flag: '🇳🇿', x: 94.8, y: 48.0 },
  { code: 'BR', nameZh: '巴西', nameEn: 'Brazil', flag: '🇧🇷', x: 35.8, y: 43.2 },
  { code: 'AR', nameZh: '阿根廷', nameEn: 'Argentina', flag: '🇦🇷', x: 32.0, y: 47.4 },
  { code: 'MX', nameZh: '墨西哥', nameEn: 'Mexico', flag: '🇲🇽', x: 21.8, y: 31.4 },
  { code: 'ZA', nameZh: '南非', nameEn: 'South Africa', flag: '🇿🇦', x: 56.6, y: 45.8 },
  { code: 'CN', nameZh: '中国大陆', nameEn: 'China', flag: '🇨🇳', x: 79.4, y: 27.6 },
  { code: 'OTHER', nameZh: '其他地区', nameEn: 'Other', flag: '🌐', x: 50.0, y: 34.0 },
];

export const REGION_MAP: Record<string, RegionMeta> = Object.fromEntries(
  REGIONS.map((region) => [region.code, region]),
);

export function getRegionMeta(code: string): RegionMeta {
  return REGION_MAP[code] ?? REGION_MAP.OTHER;
}
