export interface RegionDetectionResult {
  region: string;
  multiplier: number | null;
  tags: string[];
}

const REGION_RULES: Array<{ code: string; patterns: RegExp[] }> = [
  { code: 'HK', patterns: [/🇭🇰/u, /香港|港线|港岛|九龙/u, /\b(?:hk|hkg|hong\s*kong)\b/i] },
  { code: 'TW', patterns: [/🇹🇼/u, /台湾|台北|新北|彰化|台中|高雄/u, /\b(?:tw|tpe|taiwan|taipei)\b/i] },
  { code: 'MO', patterns: [/🇲🇴/u, /澳门/u, /\b(?:mo|macau|macao)\b/i] },
  { code: 'SG', patterns: [/🇸🇬/u, /新加坡|狮城|坡县/u, /\b(?:sg|sgp|sin|singapore)\b/i] },
  { code: 'JP', patterns: [/🇯🇵/u, /日本|东京|大阪|埼玉|京都|福冈|北海道/u, /\b(?:jp|jpn|tokyo|osaka|japan|nrt|kix)\b/i] },
  { code: 'KR', patterns: [/🇰🇷/u, /韩国|首尔|春川|釜山/u, /\b(?:kr|kor|korea|seoul|icn)\b/i] },
  { code: 'US', patterns: [/🇺🇸/u, /美国|洛杉矶|硅谷|圣何塞|西雅图|纽约|芝加哥|达拉斯|凤凰城|波特兰|弗吉尼亚|俄勒冈/u, /\b(?:us|usa|united\s*states|lax|sjc|sea|nyc|ord|dfw|iad|sfo|ashburn|silicon|los\s*angeles|san\s*jose)\b/i] },
  { code: 'CA', patterns: [/🇨🇦/u, /加拿大|多伦多|温哥华|蒙特利尔/u, /\b(?:ca|can|canada|toronto|vancouver|yyz|yvr)\b/i] },
  { code: 'GB', patterns: [/🇬🇧/u, /英国|伦敦|曼彻斯特/u, /\b(?:uk|gb|gbr|london|britain|united\s*kingdom|lhr)\b/i] },
  { code: 'DE', patterns: [/🇩🇪/u, /德国|法兰克福|柏林|慕尼黑/u, /\b(?:de|deu|germany|frankfurt|fra|berlin)\b/i] },
  { code: 'FR', patterns: [/🇫🇷/u, /法国|巴黎|马赛/u, /\b(?:fr|fra|france|paris|cdg)\b/i] },
  { code: 'NL', patterns: [/🇳🇱/u, /荷兰|阿姆斯特丹/u, /\b(?:nl|nld|netherlands|amsterdam|ams)\b/i] },
  { code: 'CH', patterns: [/🇨🇭/u, /瑞士|苏黎世|日内瓦/u, /\b(?:ch|che|switzerland|zurich|zrh)\b/i] },
  { code: 'IT', patterns: [/🇮🇹/u, /意大利|米兰|罗马/u, /\b(?:it|ita|italy|milan|rome)\b/i] },
  { code: 'ES', patterns: [/🇪🇸/u, /西班牙|马德里|巴塞罗那/u, /\b(?:es|esp|spain|madrid)\b/i] },
  { code: 'SE', patterns: [/🇸🇪/u, /瑞典|斯德哥尔摩/u, /\b(?:se|swe|sweden|stockholm)\b/i] },
  { code: 'FI', patterns: [/🇫🇮/u, /芬兰|赫尔辛基/u, /\b(?:fi|fin|finland|helsinki)\b/i] },
  { code: 'NO', patterns: [/🇳🇴/u, /挪威|奥斯陆/u, /\b(?:no|nor|norway|oslo)\b/i] },
  { code: 'IE', patterns: [/🇮🇪/u, /爱尔兰|都柏林/u, /\b(?:ie|irl|ireland|dublin)\b/i] },
  { code: 'PL', patterns: [/🇵🇱/u, /波兰|华沙/u, /\b(?:pl|pol|poland|warsaw)\b/i] },
  { code: 'RU', patterns: [/🇷🇺/u, /俄罗斯|莫斯科|伯力|圣彼得堡/u, /\b(?:ru|rus|russia|moscow)\b/i] },
  { code: 'TR', patterns: [/🇹🇷/u, /土耳其|伊斯坦布尔/u, /\b(?:tr|tur|turkey|istanbul)\b/i] },
  { code: 'AE', patterns: [/🇦🇪/u, /阿联酋|迪拜/u, /\b(?:ae|are|uae|dubai)\b/i] },
  { code: 'IN', patterns: [/🇮🇳/u, /印度|孟买|班加罗尔/u, /\b(?:in|ind|india|mumbai)\b/i] },
  { code: 'MY', patterns: [/🇲🇾/u, /马来西亚|吉隆坡/u, /\b(?:my|mys|malaysia|kul)\b/i] },
  { code: 'TH', patterns: [/🇹🇭/u, /泰国|曼谷/u, /\b(?:th|tha|thailand|bangkok)\b/i] },
  { code: 'VN', patterns: [/🇻🇳/u, /越南|胡志明|河内/u, /\b(?:vn|vnm|vietnam|hanoi)\b/i] },
  { code: 'PH', patterns: [/🇵🇭/u, /菲律宾|马尼拉/u, /\b(?:ph|phl|philippines|manila)\b/i] },
  { code: 'ID', patterns: [/🇮🇩/u, /印尼|印度尼西亚|雅加达/u, /\b(?:id|idn|indonesia|jakarta)\b/i] },
  { code: 'AU', patterns: [/🇦🇺/u, /澳大利亚|澳洲|悉尼|墨尔本/u, /\b(?:au|aus|australia|sydney|melbourne|syd)\b/i] },
  { code: 'NZ', patterns: [/🇳🇿/u, /新西兰|奥克兰/u, /\b(?:nz|nzl|new\s*zealand|auckland)\b/i] },
  { code: 'BR', patterns: [/🇧🇷/u, /巴西|圣保罗/u, /\b(?:br|bra|brazil|sao\s*paulo)\b/i] },
  { code: 'AR', patterns: [/🇦🇷/u, /阿根廷|布宜诺斯艾利斯/u, /\b(?:ar|arg|argentina)\b/i] },
  { code: 'MX', patterns: [/🇲🇽/u, /墨西哥/u, /\b(?:mx|mex|mexico)\b/i] },
  { code: 'ZA', patterns: [/🇿🇦/u, /南非|约翰内斯堡/u, /\b(?:za|zaf|south\s*africa)\b/i] },
  { code: 'CN', patterns: [/🇨🇳/u, /中国大陆|回国|广州|上海|北京|深圳|杭州/u, /\b(?:cn|chn|china)\b/i] },
];

const TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: '家宽', pattern: /家宽|住宅|家庭宽带|isp|residential|hinet|att|comcast|verizon|星链|starlink/iu },
  { tag: 'IPLC', pattern: /\biplc\b|内网专线/iu },
  { tag: 'IEPL', pattern: /\biepl\b|专线/iu },
  { tag: '原生', pattern: /原生|native|双isp/iu },
  { tag: '解锁', pattern: /流媒体|解锁|netflix|disney|gpt|ai/iu },
  { tag: 'BGP', pattern: /\bbgp\b|cn2|gia|cmin2|9929/iu },
];

export function detectRegionAndMeta(name: string, host = ''): RegionDetectionResult {
  const haystack = `${name} ${host}`;
  let region = 'OTHER';
  for (const rule of REGION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(name))) {
      region = rule.code;
      break;
    }
  }
  if (region === 'OTHER' && host) {
    for (const rule of REGION_RULES) {
      if (rule.patterns.some((pattern) => pattern.test(host))) {
        region = rule.code;
        break;
      }
    }
  }

  let multiplier: number | null = null;
  const multMatch =
    name.match(/(?:^|[\s\[\]（()|/_-])(\d+(?:\.\d+)?)\s*(?:x|X|×|倍)(?:$|[\s\[\]）()|/_-])/u) ??
    name.match(/(?:倍率|费率)[:：\s]*(\d+(?:\.\d+)?)/u);
  if (multMatch) {
    const parsed = Number(multMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100) {
      multiplier = parsed;
    }
  }

  const tags: string[] = [];
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(haystack)) {
      tags.push(rule.tag);
    }
  }
  if (multiplier !== null) {
    tags.push(`${multiplier}x`);
  }

  return { region, multiplier, tags };
}
