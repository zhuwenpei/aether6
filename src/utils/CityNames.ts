import { CITIES } from "./stations";

const OCEAN_STATION_NAMES = new Set(["洋面站点", "浮标", "临时站点"]);

// District-only reverse-geocoder labels do not contain enough information to infer a parent
// prefecture by string manipulation.  Direct-controlled municipality districts are unambiguous,
// so keep an explicit safety net for old saves / offline labels.
const MUNICIPALITY_DISTRICT_PARENT: Record<string, string> = {
  // Beijing
  "东城区": "北京", "西城区": "北京", "朝阳区": "北京", "丰台区": "北京", "石景山区": "北京", "海淀区": "北京",
  "门头沟区": "北京", "房山区": "北京", "通州区": "北京", "顺义区": "北京", "昌平区": "北京", "大兴区": "北京",
  "怀柔区": "北京", "平谷区": "北京", "密云区": "北京", "延庆区": "北京",
  // Shanghai
  "黄浦区": "上海", "徐汇区": "上海", "长宁区": "上海", "静安区": "上海", "普陀区": "上海", "虹口区": "上海",
  "杨浦区": "上海", "闵行区": "上海", "宝山区": "上海", "嘉定区": "上海", "浦东新区": "上海", "金山区": "上海",
  "松江区": "上海", "青浦区": "上海", "奉贤区": "上海", "崇明区": "上海",
  // Tianjin
  "和平区": "天津", "河东区": "天津", "河西区": "天津", "南开区": "天津", "河北区": "天津", "红桥区": "天津",
  "东丽区": "天津", "西青区": "天津", "津南区": "天津", "北辰区": "天津", "武清区": "天津", "宝坻区": "天津",
  "滨海新区": "天津", "宁河区": "天津", "静海区": "天津", "蓟州区": "天津",
  // Chongqing (only district names that are sufficiently characteristic; ambiguous names rely on coordinates)
  "渝中区": "重庆", "大渡口区": "重庆", "江北区": "重庆", "沙坪坝区": "重庆", "九龙坡区": "重庆", "南岸区": "重庆",
  "北碚区": "重庆", "渝北区": "重庆", "巴南区": "重庆", "黔江区": "重庆", "长寿区": "重庆", "江津区": "重庆",
  "合川区": "重庆", "永川区": "重庆", "南川区": "重庆", "綦江区": "重庆", "大足区": "重庆", "璧山区": "重庆",
  "铜梁区": "重庆", "潼南区": "重庆", "荣昌区": "重庆", "开州区": "重庆", "梁平区": "重庆", "武隆区": "重庆"
};

// UI labels for Chinese stations use the formal city-level suffix.  Internal models continue to
// use compact keys (e.g. "上海", "深圳") so airport/warning lookup tables remain stable.
const CHINESE_CITY_NAMES = new Set([
  "北京", "上海", "广州", "深圳", "台北", "高雄", "花莲", "宜兰", "台南", "福州", "厦门", "杭州", "温州", "青岛", "南京",
  "海口", "三亚", "南宁", "武汉", "长沙", "成都", "重庆", "济南", "石家庄", "郑州", "太原", "西安", "兰州",
  "贵阳", "昆明", "桂林", "汕头", "湛江", "北海", "泉州", "莆田", "宁德", "台州", "宁波", "舟山", "嘉兴",
  "南通", "盐城", "连云港", "日照", "烟台", "威海", "天津", "秦皇岛", "大连", "丹东", "珠海", "阳江", "茂名",
  "南昌", "惠州", "中山", "潮州", "揭阳", "龙岩", "丽水", "衢州", "湖州", "泰州", "扬州", "淮安", "潍坊", "营口",
  "钦州", "玉林", "梧州", "琼海", "文昌", "漳州", "防城港", "三沙"
]);

// Denser city catalogue used only for resolving a district/county label to its parent city.
// Keeping it here avoids coupling the name normalizer back to Engine.ts and also gives offline
// report/station views enough coverage for the coastal areas most frequently affected by typhoons.
const STATION_CITY_CATALOG: Array<{ name: string; lat: number; lon: number }> = [
  ...CITIES,
  { name: "珠海", lat: 22.2707, lon: 113.5767 }, { name: "台南", lat: 22.9997, lon: 120.2270 },
  { name: "福冈", lat: 33.5904, lon: 130.4017 }, { name: "阳江", lat: 21.8511, lon: 111.9778 },
  { name: "茂名", lat: 21.6629, lon: 110.9234 }, { name: "南昌", lat: 28.6820, lon: 115.8579 },
  { name: "惠州", lat: 23.1115, lon: 114.4156 }, { name: "中山", lat: 22.5170, lon: 113.3928 },
  { name: "潮州", lat: 23.6569, lon: 116.6226 }, { name: "揭阳", lat: 23.5498, lon: 116.3729 },
  { name: "漳州", lat: 24.5129, lon: 117.6470 }, { name: "龙岩", lat: 25.0916, lon: 117.0179 },
  { name: "丽水", lat: 28.4676, lon: 119.9230 }, { name: "衢州", lat: 28.9358, lon: 118.8758 },
  { name: "湖州", lat: 30.8943, lon: 120.0868 }, { name: "泰州", lat: 32.4555, lon: 119.9229 },
  { name: "扬州", lat: 32.3942, lon: 119.4129 }, { name: "淮安", lat: 33.6104, lon: 119.0153 },
  { name: "潍坊", lat: 36.7068, lon: 119.1618 }, { name: "营口", lat: 40.6670, lon: 122.2354 },
  { name: "钦州", lat: 21.9664, lon: 108.6242 }, { name: "玉林", lat: 22.6363, lon: 110.1652 },
  { name: "梧州", lat: 23.4770, lon: 111.2791 }, { name: "琼海", lat: 19.2435, lon: 110.4668 },
  { name: "文昌", lat: 19.6129, lon: 110.7540 }, { name: "宜兰", lat: 24.7570, lon: 121.7530 },
  { name: "防城港", lat: 21.6136, lon: 108.3533 }, { name: "三沙", lat: 16.8333, lon: 112.3333 }
];

function cleanRawStationName(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/中华人民共和国/g, "")
    .replace(/^中国(?:台湾省|台湾地区|香港特别行政区|澳门特别行政区)?/, "")
    .replace(/^中国/, "")
    .replace(/气象站$/g, "")
    .replace(/自动站$/g, "")
    .replace(/观测站$/g, "")
    .replace(/国家站$/g, "")
    .trim();
}

/** Keep the model's canonical station key at city level, without inventing a parent city. */
export function cityOnlyName(raw: string): string {
  let name = cleanRawStationName(raw);
  if (!name) return "未知城市";
  if (OCEAN_STATION_NAMES.has(name)) return name;

  const legacyCityAlias: Record<string, string> = {
    "关岛": "阿加尼亚", "塞班": "加拉班", "塞班岛": "加拉班", "帕劳": "柯罗", "帕劳(柯罗)": "柯罗",
    "帕劳（柯罗）": "柯罗", "楚克群岛": "维诺", "石垣岛": "石垣", "火奴鲁鲁(夏威夷)": "火奴鲁鲁",
    "火奴鲁鲁（夏威夷）": "火奴鲁鲁", "奥克兰(新西兰)": "奥克兰", "奥克兰（新西兰）": "奥克兰",
    "苏瓦(斐济)": "苏瓦", "苏瓦（斐济）": "苏瓦", "卡波圣卢卡斯(墨西哥)": "卡波圣卢卡斯", "卡波圣卢卡斯（墨西哥）": "卡波圣卢卡斯"
  };
  if (legacyCityAlias[name]) return legacyCityAlias[name];
  if (MUNICIPALITY_DISTRICT_PARENT[name]) return MUNICIPALITY_DISTRICT_PARENT[name];

  const municipality = name.match(/(?:北京市|上海市|天津市|重庆市|香港(?:特别行政区)?|澳门(?:特别行政区)?)/);
  if (municipality) return municipality[0].replace(/特别行政区$/, "").replace(/市$/, "");

  // If the reverse geocoder returned a complete administrative chain such as
  // "广东省深圳市南山区", keep the explicit parent city and ignore the district.
  const embeddedCity = name.match(/([^省自治区特别行政区州盟县区旗]{1,12}?)市/);
  if (embeddedCity) return embeddedCity[1];

  name = name.replace(/[（(].*?[）)]/g, "").trim();

  // A bare district/county ("长宁区", "南山区") is *not* a city.  Do not fabricate
  // "长宁"/"长宁市".  Callers with coordinates should use stationCityName(), which resolves
  // the parent municipality/prefecture spatially.
  if (/(?:新区|县|区|旗|镇|乡|街道|村)$/.test(name)) {
    return MUNICIPALITY_DISTRICT_PARENT[name] || name;
  }

  return name.replace(/(?:特别行政区|自治州|地区|市)$/g, "").trim() || "未知城市";
}

export function nearestKnownCityName(lat: number, lon: number, maxDistanceKm = 260): string {
  let best: { name: string; distKm: number } | null = null;
  const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
  for (const city of STATION_CITY_CATALOG) {
    const dy = (city.lat - lat) * 111.12;
    const dx = (city.lon - lon) * 111.12 * cosLat;
    const distKm = Math.hypot(dx, dy);
    if (!best || distKm < best.distKm) best = { name: cityOnlyName(city.name), distKm };
  }
  return best && best.distKm <= maxDistanceKm ? best.name : "未知城市";
}

/**
 * Resolve a station to its parent city using both the label and the station coordinate.
 * This is the function UI/report code should use for district/county reverse-geocoder output.
 */
export function stationCityName(raw: string, lat: number, lon: number): string {
  const cleaned = cleanRawStationName(raw);
  if (!cleaned) return nearestKnownCityName(lat, lon) || "未知城市";
  if (OCEAN_STATION_NAMES.has(cleaned)) return cleaned;

  const direct = cityOnlyName(cleaned);
  if (direct !== cleaned || !/(?:新区|县|区|旗|镇|乡|街道|村)$/.test(cleaned)) {
    return direct;
  }

  // District/county-only names need geographic context.  A tighter limit avoids snapping a
  // remote rural station to a famous but unrelated city when the built-in catalogue is sparse.
  const nearest = nearestKnownCityName(lat, lon, 135);
  if (nearest !== "未知城市") return nearest;

  // Preserve the administrative label rather than creating a fake city name.  In online flows
  // fetchOsmStationName() will normally replace this with the true parent prefecture.
  return cleaned;
}

/** Formal UI label. Chinese city-level stations display the 市 suffix; model keys stay compact. */
export function stationCityDisplayName(raw: string, lat: number, lon: number): string {
  const city = stationCityName(raw, lat, lon);
  if (OCEAN_STATION_NAMES.has(city) || city === "未知城市") return city;
  if (city === "香港" || city === "澳门") return city;
  return CHINESE_CITY_NAMES.has(city) ? `${city}市` : city;
}
