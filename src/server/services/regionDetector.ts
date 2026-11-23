export interface RegionDetectionResult {
  region: string;
  multiplier: number | null;
  tags: string[];
}

const REGION_RULES: Array<{ code: string; patterns: RegExp[] }> = [
  {
    code: 'HK',
    patterns: [
      /🇭🇰/u,
      /香港|港线|港島|港岛|九龙|九龍|新界|深港|沪港|滬港|广港|廣港/u,
      /\b(?:hk|hkg|hong\s*kong)\b/i,
    ],
  },
  {
    code: 'TW',
    patterns: [
      /🇹🇼/u,
      /台湾|台灣|台北|新北|彰化|台中|台南|高雄|桃园|桃園|新竹|基隆|花莲|花蓮/u,
      /\b(?:tw|tpe|taiwan|taipei|kaohsiung)\b/i,
    ],
  },
  {
    code: 'MO',
    patterns: [/🇲🇴/u, /澳门|澳門/u, /\b(?:mo|macau|macao)\b/i],
  },
  {
    code: 'SG',
    patterns: [/🇸🇬/u, /新加坡|狮城|獅城|坡县|坡縣/u, /\b(?:sg|sgp|sin|singapore)\b/i],
  },
  {
    code: 'JP',
    patterns: [
      /🇯🇵/u,
      /日本|东京|東京|大阪|埼玉|京都|福冈|福岡|北海道|名古屋|冲绳|沖繩/u,
      /\b(?:jp|jpn|tokyo|osaka|japan|nrt|kix|hnd)\b/i,
    ],
  },
  {
    code: 'KR',
    patterns: [/🇰🇷/u, /韩国|韓國|首尔|首爾|春川|釜山|仁川/u, /\b(?:kr|kor|korea|seoul|icn)\b/i],
  },
  {
    code: 'US',
    patterns: [
      /🇺🇸/u,
      /美国|美國|美西|美东|美東|美中|美南|美北|洛杉矶|洛杉磯|硅谷|矽谷|圣何塞|聖何塞|西雅图|西雅圖|纽约|紐約|芝加哥|达拉斯|達拉斯|凤凰城|鳳凰城|波特兰|波特蘭|弗吉尼亚|維吉尼亞|俄勒冈|俄勒岡|拉斯维加斯|拉斯維加斯|迈阿密|邁阿密|波士顿|波士頓|休斯顿|休斯頓/u,
      /\b(?:us|usa|united\s*states|lax|sjc|sea|nyc|ord|dfw|iad|sfo|ashburn|silicon|los\s*angeles|san\s*jose|new\s*york|chicago|seattle|miami|boston|houston)\b/i,
    ],
  },
  {
    code: 'CA',
    patterns: [
      /🇨🇦/u,
      /加拿大|多伦多|多倫多|温哥华|溫哥華|蒙特利尔|蒙特婁|卡尔加里|卡爾加里|渥太华|渥太華/u,
      /\b(?:ca|can|canada|toronto|vancouver|yyz|yvr|calgary)\b/i,
    ],
  },
  {
    code: 'GB',
    patterns: [/🇬🇧/u, /英国|英國|伦敦|倫敦|曼彻斯特|曼徹斯特|伯明翰/u, /\b(?:uk|gb|gbr|london|britain|united\s*kingdom|lhr)\b/i],
  },
  {
    code: 'DE',
    patterns: [/🇩🇪/u, /德国|德國|法兰克福|法蘭克福|柏林|慕尼黑|纽伦堡|紐倫堡/u, /\b(?:de|deu|germany|frankfurt|fra|berlin|munich)\b/i],
  },
  {
    code: 'FR',
    patterns: [/🇫🇷/u, /法国|法國|巴黎|马赛|馬賽/u, /\b(?:fr|fra|france|paris|cdg|marseille)\b/i],
  },
  {
    code: 'NL',
    patterns: [/🇳🇱/u, /荷兰|荷蘭|阿姆斯特丹/u, /\b(?:nl|nld|netherlands|amsterdam|ams)\b/i],
  },
  {
    code: 'CH',
    patterns: [/🇨🇭/u, /瑞士|苏黎世|蘇黎世|日内瓦|日內瓦/u, /\b(?:ch|che|switzerland|zurich|zrh|geneva)\b/i],
  },
  {
    code: 'IT',
    patterns: [/🇮🇹/u, /意大利|義大利|米兰|米蘭|罗马|羅馬/u, /\b(?:it|ita|italy|milan|rome)\b/i],
  },
  {
    code: 'ES',
    patterns: [/🇪🇸/u, /西班牙|马德里|馬德里|巴塞罗那|巴塞隆納/u, /\b(?:es|esp|spain|madrid|barcelona)\b/i],
  },
  {
    code: 'SE',
    patterns: [/🇸🇪/u, /瑞典|斯德哥尔摩|斯德哥爾摩/u, /\b(?:se|swe|sweden|stockholm)\b/i],
  },
  {
    code: 'FI',
    patterns: [/🇫🇮/u, /芬兰|芬蘭|赫尔辛基|赫爾辛基/u, /\b(?:fi|fin|finland|helsinki)\b/i],
  },
  {
    code: 'NO',
    patterns: [/🇳🇴/u, /挪威|奥斯陆|奧斯陸/u, /\b(?:no|nor|norway|oslo)\b/i],
  },
  {
    code: 'IE',
    patterns: [/🇮🇪/u, /爱尔兰|愛爾蘭|都柏林/u, /\b(?:ie|irl|ireland|dublin)\b/i],
  },
  {
    code: 'PL',
    patterns: [/🇵🇱/u, /波兰|波蘭|华沙|華沙/u, /\b(?:pl|pol|poland|warsaw)\b/i],
  },
  {
    code: 'RU',
    patterns: [/🇷🇺/u, /俄罗斯|俄羅斯|莫斯科|伯力|圣彼得堡|聖彼得堡|海参崴|海參崴/u, /\b(?:ru|rus|russia|moscow)\b/i],
  },
  {
    code: 'TR',
    patterns: [/🇹🇷/u, /土耳其|伊斯坦布尔|伊斯坦堡/u, /\b(?:tr|tur|turkey|istanbul)\b/i],
  },
  {
    code: 'AE',
    patterns: [/🇦🇪/u, /阿联酋|阿聯酋|迪拜|杜拜/u, /\b(?:ae|are|uae|dubai)\b/i],
  },
  {
    code: 'MY',
    patterns: [/🇲🇾/u, /马来西亚|馬來西亞|吉隆坡/u, /\b(?:my|mys|malaysia|kul)\b/i],
  },
  {
    code: 'TH',
    patterns: [/🇹🇭/u, /泰国|泰國|曼谷/u, /\b(?:th|tha|thailand|bangkok)\b/i],
  },
  {
    code: 'VN',
    patterns: [/🇻🇳/u, /越南|胡志明|河内|河內/u, /\b(?:vn|vnm|vietnam|hanoi)\b/i],
  },
  {
    code: 'PH',
    patterns: [/🇵🇭/u, /菲律宾|菲律賓|马尼拉|馬尼拉/u, /\b(?:ph|phl|philippines|manila)\b/i],
  },
  {
    code: 'ID',
    patterns: [/🇮🇩/u, /印尼|印度尼西亚|印度尼西亞|雅加达|雅加達/u, /\b(?:id|idn|indonesia|jakarta)\b/i],
  },
  {
    code: 'IN',
    patterns: [/🇮🇳/u, /印度|孟买|孟買|班加罗尔|班加羅爾/u, /\b(?:in|ind|india|mumbai|bengaluru)\b/i],
  },
  {
    code: 'AU',
    patterns: [/🇦🇺/u, /澳大利亚|澳大利亞|澳洲|悉尼|雪梨|墨尔本|墨爾本/u, /\b(?:au|aus|australia|sydney|melbourne|syd)\b/i],
  },
  {
    code: 'NZ',
    patterns: [/🇳🇿/u, /新西兰|新西蘭|奥克兰|奧克蘭/u, /\b(?:nz|nzl|new\s*zealand|auckland)\b/i],
  },
  {
    code: 'BR',
    patterns: [/🇧🇷/u, /巴西|圣保罗|聖保羅/u, /\b(?:br|bra|brazil|sao\s*paulo)\b/i],
  },
  {
    code: 'AR',
    patterns: [/🇦🇷/u, /阿根廷|布宜诺斯艾利斯|布宜諾斯艾利斯/u, /\b(?:ar|arg|argentina)\b/i],
  },
  {
    code: 'MX',
    patterns: [/🇲🇽/u, /墨西哥/u, /\b(?:mx|mex|mexico)\b/i],
  },
  {
    code: 'ZA',
    patterns: [/🇿🇦/u, /南非|约翰内斯堡|約翰尼斯堡/u, /\b(?:za|zaf|south\s*africa|johannesburg)\b/i],
  },
  {
    code: 'CN',
    patterns: [
      /🇨🇳/u,
      /中国大陆|中國大陸|回国|回國|广州|廣州|上海|北京|深圳|杭州|成都|南京|武汉|武漢|西安|重庆|重慶|天津|厦门|廈門/u,
      /\b(?:cn|chn|china)\b/i,
    ],
  },
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
    name.match(
      /(?:^|[\s\[\]（()|/_,;:-])(?:[x×]\s*(\d+(?:\.\d+)?))(?=$|[^\d.])/iu,
    ) ??
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
