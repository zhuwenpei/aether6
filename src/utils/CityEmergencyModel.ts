import type { StationReading, Typhoon } from "../types";
import { cityOnlyName } from "./CityNames";
import { evaluateWarningOperationalOutcome, getDisasterCapabilityProfile, type WarningOperationalOutcome } from "./DisasterPreparednessModel";
import { getTyphoonOrdinalNumber, normalizeTyphoonSequenceNumber } from "./TyphoonDisplayName";

export type WarningRegion = "mainland" | "hongkong" | "macau" | "taiwan" | "philippines" | "japan" | "korea" | "generic";
export type WarningStatus = {
  id: string;
  severity: number;
  label: string;
  authority: string;
  reason: string;
  action: string;
  leadHours?: number;
  sourceNote: string;
  truthSeverity?: number;
  operationalAnomaly?: WarningOperationalOutcome["anomaly"];
  issueDelayHours?: number;
};

/** Public status scope. Exact point observations stay separate from this district-level anchor. */
export type PublicAreaStation = {
  name: string;
  lat: number;
  lon: number;
  city?: string;
  district?: string;
  country?: string;
  areaKey?: string;
  areaDisplayName?: string;
};
export type ForecastImpact = {
  leadHour: number;
  distanceKm: number;
  wind: number;
  gust: number;
  rainRate: number;
  cycloneVmax: number;
  cyclonePmin: number;
  r7: number;
};
export type InfrastructureProfile = {
  index: number;
  drainageMmPerHour: number;
  lowlandFactor: number;
  label: string;
};
export type EmergencyNewsItem = {
  id: string;
  simHour: number;
  type: "warning" | "hazard" | "traffic" | "guidance" | "response" | "information";
  severity: number;
  title: string;
  body: string;
};

export type StationHistoryDatum = {
  time: number;
  wind: number;
  pressure: number;
  precipitation: number;
  stormSurge: number;
  casualties?: number;
};

const OFFICIAL_RULE_NOTES: Record<WarningRegion, string> = {
  mainland: "中国气象灾害预警信号：蓝/黄/橙/红，并考虑24/24/12/6小时提前量与平均风/阵风阈值。",
  hongkong: "香港天文台热带气旋警告信号：1、3、8、9、10号；1号考虑约800公里范围，3/8/10号对应强风、烈风/暴风、飓风。",
  macau: "澳门地球物理气象局热带气旋信号：1、3、8、9、10号，模拟中按本地预期风力、近中心程度和增强趋势判级。",
  taiwan: "台湾中央气象署：7级风暴风范围可能侵袭近海前24小时发布海上警报，可能侵袭陆上前18小时发布陆上警报。",
  philippines: "PAGASA Modified TCWS (2022)：TCWS 1–5分别对应10.8–17.1、17.2–24.4、24.5–32.6、32.7–51.2、≥51.3 m/s，并使用36/24/18/12/12小时提前量。",
  japan: "日本气象厅：按区域风雨风险发布注意报/警报；特别警报还参考强台风接近时的中心气压和最大风速指标。",
  korea: "韩国气象厅：强风注意报14 m/s（阵风20），警报21 m/s（阵风26）；台风达到相应强风、暴雨或高潮标准时发布台风注意报/警报。",
  generic: "通用模拟预警：综合未来路径、近地风、阵风、降水和风暴增水风险判级。"
};

function publicAreaCity(station: PublicAreaStation): string {
  return cityOnlyName(station.city || station.name);
}

function publicAreaName(station: PublicAreaStation): string {
  return String(station.areaDisplayName || station.district || station.name || publicAreaCity(station)).trim();
}

function publicAreaSeed(station: PublicAreaStation): string {
  return String(station.areaKey || `${publicAreaCity(station)}|${station.district || publicAreaName(station)}`);
}

function localMeteorologicalAuthority(station: PublicAreaStation): string {
  const area = String(station.areaDisplayName || station.district || publicAreaName(station) || publicAreaCity(station));
  const clean = area.replace(/全市$/, "");
  return `模拟${clean}气象台`;
}

export function getWarningRegion(name: string, lat: number, lon: number): WarningRegion {
  const city = cityOnlyName(name);
  // Prefer the city label over overlapping coordinate boxes.  Shenzhen and Hong Kong are only
  // tens of kilometres apart, so a broad HK bounding box would otherwise give Shenzhen a wind
  // signal number instead of a mainland colour warning.
  if (city === "香港") return "hongkong";
  if (city === "澳门") return "macau";
  if (["台北", "新北", "基隆", "桃园", "新竹", "台中", "嘉义", "台南", "高雄", "花莲", "台东", "宜兰", "屏东", "澎湖"].includes(city)) return "taiwan";
  if (["马尼拉", "宿务", "黎牙实比", "塔克洛班", "苏里高", "土格加劳", "佬沃", "维甘"].includes(city)) return "philippines";
  if (["东京", "大阪", "那霸", "鹿儿岛", "福冈", "长崎", "高知", "名古屋", "横滨", "石垣岛"].includes(city)) return "japan";
  if (["首尔", "釜山", "济州", "仁川", "江陵", "束草"].includes(city)) return "korea";

  // Coordinate fallback is reserved for generic/reverse-geocoded names.  Keep the HK/Macau boxes
  // deliberately tight so neighbouring Pearl River Delta cities are not misclassified.
  if (["未知城市", "临时站点"].includes(city)) {
    if (lat >= 22.15 && lat <= 22.50 && lon >= 113.82 && lon <= 114.43) return "hongkong";
    if (lat >= 22.08 && lat <= 22.24 && lon >= 113.48 && lon <= 113.65) return "macau";
  }
  if (lat >= 21.4 && lat <= 25.8 && lon >= 119.2 && lon <= 122.5) return "taiwan";
  if (lat >= 4 && lat <= 22.3 && lon >= 116 && lon <= 127.5) return "philippines";
  if (lat >= 24 && lat <= 46.5 && lon >= 123 && lon <= 146.8) return "japan";
  if (lat >= 32.5 && lat <= 39.5 && lon >= 124 && lon <= 132.2) return "korea";
  if (lat >= 18 && lat <= 46 && lon >= 105 && lon <= 124.5) return "mainland";
  return "generic";
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(Math.max(0, 1 - aa)));
}

function averageR7(ty: Typhoon): number {
  const vals = ty.r7 ? Object.values(ty.r7).map(Number).filter((v) => v > 0) : [];
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Math.max(120, ty.vmax * 4.1);
}

function estimateLocalWind(vmax: number, dist: number, rmw: number, r7: number): number {
  if (dist <= rmw) {
    const f = Math.max(0, Math.min(1, dist / Math.max(6, rmw)));
    return vmax * (0.30 + 0.70 * Math.pow(f, 0.72));
  }
  if (dist <= r7) {
    const f = (dist - rmw) / Math.max(1, r7 - rmw);
    return vmax + (13.9 - vmax) * Math.max(0, Math.min(1, f));
  }
  return Math.max(0, 13.9 * Math.exp(-(dist - r7) / 150));
}

function deterministic01(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function buildForecastImpacts(ty: Typhoon, station: PublicAreaStation, reading?: StationReading): ForecastImpact[] {
  const baseR7 = averageR7(ty);
  const points = [
    { lat: ty.lat, lon: ty.lon, vmax: ty.vmax, pmin: ty.pmin, simHour: 0 },
    ...(ty.forecastPath || []).filter((p) => p.simHour > 0 && p.simHour <= 48)
  ];
  return points.map((p, index) => {
    const leadHour = Number(p.simHour || 0);
    const dist = distanceKm(station.lat, station.lon, p.lat, p.lon);
    // 5.2.28: live simulation forecast tracks are deliberately geometry-only. Civil-warning
    // previews must not accidentally reintroduce forecast-intensity integration on the simulation
    // thread. Until a forecast product explicitly materializes intensity, project the *current
    // observed* cyclone intensity along the stored path as a lightweight preparedness proxy.
    const forecastIntensityDeferred = (p as any).intensityDeferred === true
      || !Number.isFinite(Number((p as any).vmax))
      || Number((p as any).vmax) <= 0;
    const pointVmax = forecastIntensityDeferred ? Number(ty.vmax || 0) : Number((p as any).vmax);
    const pointPmin = forecastIntensityDeferred ? Number(ty.pmin || 1010) : Number((p as any).pmin);
    const intensityRatio = Math.max(0.45, Math.min(1.45, pointVmax / Math.max(12, ty.vmax)));
    const r7 = Math.max(90, baseR7 * (0.72 + 0.28 * intensityRatio));
    const rmw = Math.max(12, (ty.rmw || 35) * (0.82 + 0.18 / Math.max(0.55, intensityRatio)));
    let wind = estimateLocalWind(pointVmax, dist, rmw, r7);
    let rainRate = Math.max(0, (pointVmax - 11) * 1.02) * Math.exp(-dist / Math.max(90, r7 * 0.58));
    const bandPulse = 0.68 + 0.48 * deterministic01(`${ty.id}:${publicAreaSeed(station)}:${leadHour}:band`);
    rainRate *= bandPulse;
    if (index === 0 && reading) {
      wind = Number(reading.windSpeed || wind);
      rainRate = Number(reading.precipitation || rainRate);
    }
    const gust = index === 0 && reading?.gustSpeed != null
      ? Number(reading.gustSpeed)
      : wind * (1.20 + 0.14 * Math.min(1, rainRate / 35));
    return { leadHour, distanceKm: dist, wind, gust, rainRate, cycloneVmax: pointVmax, cyclonePmin: pointPmin, r7 };
  }).sort((a, b) => a.leadHour - b.leadHour);
}


/**
 * Lightweight district representative history. It is intentionally independent of the user's
 * exact double-click coordinate so every point inside one resolved administrative district shares
 * warnings, transport/airport state and the emergency feed. Exact displayed observations continue
 * to come from the clicked point's full station engine.
 */
export function buildDistrictPublicHistory(ty: Typhoon, station: PublicAreaStation): StationHistoryDatum[] {
  const rows = (ty.history || []).filter((h) => h.simHour <= (ty.simHour || 0) + 1e-6).sort((a, b) => a.simHour - b.simHour);
  const seed = publicAreaSeed(station);
  return rows.map((h) => {
    const vals = h.r7 ? Object.values(h.r7).map(Number).filter((v) => v > 0) : [];
    const r7 = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : Math.max(120, h.vmax * 4.1);
    const dist = distanceKm(station.lat, station.lon, h.lat, h.lon);
    const rmw = Math.max(10, Number(h.rmw || 35));
    const wind = estimateLocalWind(Number(h.vmax || 0), dist, rmw, r7);
    const pressureWeight = dist <= rmw ? 1 - 0.55 * Math.pow(Math.max(0, dist / rmw), 1.35) : Math.exp(-(dist - rmw) / Math.max(95, r7 * 0.72));
    const pressure = 1013 - (1013 - Number(h.pmin || 1000)) * Math.max(0, Math.min(1, pressureWeight));
    let precipitation = Math.max(0, (Number(h.vmax || 0) - 11) * 0.98) * Math.exp(-dist / Math.max(85, r7 * 0.57));
    precipitation *= 0.66 + 0.52 * deterministic01(`${ty.id}:${seed}:${h.simHour}:public-rain`);
    const coastalFactor = 0.35 + 0.65 * getDistrictRiskProfile(station).coastal;
    const surge = Math.max(0, Math.min(3.2, ((1013 - pressure) * 0.010 + wind * wind * 0.00058) * coastalFactor));
    return {
      time: h.simHour,
      wind: Number(wind.toFixed(1)),
      pressure: Number(pressure.toFixed(1)),
      precipitation: Number(precipitation.toFixed(1)),
      stormSurge: Number(surge.toFixed(2)),
      casualties: 0
    };
  });
}

export function buildDistrictRepresentativeReading(ty: Typhoon, station: PublicAreaStation, historyInput?: StationHistoryDatum[]): StationReading {
  const impacts = buildForecastImpacts(ty, station);
  const now = impacts[0] || { wind: 0, gust: 0, rainRate: 0, distanceKm: 999, leadHour: 0, cycloneVmax: ty.vmax, cyclonePmin: ty.pmin, r7: averageR7(ty) };
  const rmw = Math.max(10, Number(ty.rmw || 35));
  const pressureWeight = now.distanceKm <= rmw ? 1 - 0.55 * Math.pow(Math.max(0, now.distanceKm / rmw), 1.35) : Math.exp(-(now.distanceKm - rmw) / Math.max(95, now.r7 * 0.72));
  const pressure = 1013 - (1013 - Number(ty.pmin || 1000)) * Math.max(0, Math.min(1, pressureWeight));
  const profile = getDistrictRiskProfile(station);
  const surge = Math.max(0, Math.min(3.2, ((1013 - pressure) * 0.010 + now.wind * now.wind * 0.00058) * (0.35 + 0.65 * profile.coastal)));
  const history = historyInput || buildDistrictPublicHistory(ty, station);
  const accumPrecip = history.reduce((sum, r) => sum + Math.max(0, r.precipitation), 0);
  return {
    name: publicAreaName(station), windSpeed: now.wind, gustSpeed: now.gust, pressure,
    precipitation: now.rainRate, maxWindSpeed: now.gust, accumPrecip, stormSurge: surge,
    maxStormSurge: Math.max(surge, ...history.map((r) => r.stormSurge || 0), 0), casualties: 0,
    warning: "district-public-model", diagnosticVersion: "3.7.5-district-public-v1"
  };
}

function maxWithin(impacts: ForecastImpact[], hours: number, key: "wind" | "gust" | "rainRate"): ForecastImpact | null {
  const rows = impacts.filter((r) => r.leadHour <= hours + 1e-6);
  return rows.length ? rows.reduce((a, b) => b[key] > a[key] ? b : a) : null;
}

function closestWithin(impacts: ForecastImpact[], hours: number): ForecastImpact | null {
  const rows = impacts.filter((r) => r.leadHour <= hours + 1e-6);
  return rows.length ? rows.reduce((a, b) => b.distanceKm < a.distanceKm ? b : a) : null;
}

function warningDirection(station: { lat: number; lon: number }, impact: ForecastImpact, ty: Typhoon): string {
  const p = impact.leadHour === 0 ? { lat: ty.lat, lon: ty.lon } : (ty.forecastPath || []).find((x) => Math.abs(x.simHour - impact.leadHour) < 0.2) || { lat: ty.lat, lon: ty.lon };
  const y = p.lat - station.lat;
  const x = (p.lon - station.lon) * Math.max(0.2, Math.cos(station.lat * Math.PI / 180));
  const bearing = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  // Approximate counter-clockwise near-surface flow in the Northern Hemisphere and report the
  // direction FROM which the local wind is expected to blow.
  const from = (bearing + 90 + 180) % 360;
  if (from < 45 || from >= 315) return "北";
  if (from < 135) return "东";
  if (from < 225) return "南";
  return "西";
}

function buildIdealPrimaryWarning(ty: Typhoon, station: PublicAreaStation, reading?: StationReading): WarningStatus {
  const region = getWarningRegion(station.name, station.lat, station.lon);
  const impacts = buildForecastImpacts(ty, station, reading);
  const within6 = maxWithin(impacts, 6, "wind");
  const gust6 = maxWithin(impacts, 6, "gust");
  const within12 = maxWithin(impacts, 12, "wind");
  const gust12 = maxWithin(impacts, 12, "gust");
  const within18 = maxWithin(impacts, 18, "wind");
  const within24 = maxWithin(impacts, 24, "wind");
  const gust24 = maxWithin(impacts, 24, "gust");
  const within36 = maxWithin(impacts, 36, "wind");
  const closest6 = closestWithin(impacts, 6);
  const closest12 = closestWithin(impacts, 12);
  const closest24 = closestWithin(impacts, 24);
  const closest36 = closestWithin(impacts, 36);
  const sourceNote = OFFICIAL_RULE_NOTES[region];
  const mainlandAuthority = localMeteorologicalAuthority(station);
  const none = (label = "无台风预警"): WarningStatus => {
    if (region === "philippines") return { id: `${region}-0`, severity: 0, label, authority: "PAGASA (SIMULATED)", reason: "The forecast track has not reached the local Tropical Cyclone Wind Signal criteria.", action: "Continue monitoring subsequent simulated bulletins and local weather conditions.", sourceNote };
    if (region === "japan") return { id: `${region}-0`, severity: 0, label, authority: "気象庁（シミュレーション）", reason: "現在の予報では、この地域の台風に関する警報・注意報基準に達していません。", action: "今後の進路・強度と最新の気象情報を確認してください。", sourceNote };
    if (region === "korea") return { id: `${region}-0`, severity: 0, label, authority: "기상청 (모의)", reason: "현재 예보에서는 이 지역의 태풍특보 기준에 도달하지 않았습니다.", action: "후속 진로·강도 예보와 최신 기상정보를 확인하십시오.", sourceNote };
    if (region === "taiwan") return { id: `${region}-0`, severity: 0, label, authority: "中央氣象署（模擬）", reason: "目前預報尚未達到本地颱風警報發布條件。", action: "持續留意後續路徑、強度及地方防災資訊。", sourceNote };
    if (region === "hongkong") return { id: `${region}-0`, severity: 0, label, authority: "香港天文台（模擬）", reason: "目前預測路徑尚未達到本港熱帶氣旋警告信號準則。", action: "請繼續留意最新熱帶氣旋消息。", sourceNote };
    if (region === "macau") return { id: `${region}-0`, severity: 0, label, authority: "地球物理氣象局（模擬）", reason: "目前預測尚未達到本澳熱帶氣旋信號準則。", action: "請繼續留意最新熱帶氣旋消息。", sourceNote };
    return { id: `${region}-0`, severity: 0, label, authority: region === "mainland" ? mainlandAuthority : "模拟城市应急气象中心", reason: "未来预报路径暂未达到本地台风预警触发条件。", action: "保持关注后续路径和强度变化。", sourceNote };
  };

  if (region === "mainland") {
    // GB/T 43237-2023 gives local typhoon-signal examples that combine forecast wind and
    // short-duration rainfall. Keep the simulator's district warning sensitive to either route:
    // a rain-dominant outer band can therefore raise a local signal even when the eyewall stays away.
    const rain3 = projectedRain(impacts, 3);
    const rain6 = projectedRain(impacts, 6);
    const rain12 = projectedRain(impacts, 12);
    const rain24 = projectedRain(impacts, 24);
    if ((within6?.wind || 0) >= 32.7 || (gust6?.gust || 0) >= 41.5 || rain6 >= 200 || rain3 >= 100) return { id: "cn-red", severity: 4, label: "台风红色预警", authority: mainlandAuthority, reason: `未来6小时平均风最高${(within6?.wind || 0).toFixed(1)} m/s、阵风${(gust6?.gust || 0).toFixed(1)} m/s；预计3/6小时累计降水约${rain3.toFixed(0)}/${rain6.toFixed(0)} mm。`, action: "进入最高级别防风响应，停止高风险户外活动并转移危险区域人员。", leadHours: 6, sourceNote };
    if ((within12?.wind || 0) >= 24.5 || (gust12?.gust || 0) >= 32.7 || rain12 >= 200 || rain6 >= 100) return { id: "cn-orange", severity: 3, label: "台风橙色预警", authority: mainlandAuthority, reason: `未来12小时存在破坏性强风或极端强降水风险；预计6/12小时累计降水约${rain6.toFixed(0)}/${rain12.toFixed(0)} mm。`, action: "停止大部分户外作业，重点巡查易涝点、工地和沿海设施。", leadHours: 12, sourceNote };
    if ((within24?.wind || 0) >= 17.2 || (gust24?.gust || 0) >= 24.5 || rain12 >= 100 || rain6 >= 50) return { id: "cn-yellow", severity: 2, label: "台风黄色预警", authority: mainlandAuthority, reason: `未来24小时本区可能出现较强风雨；预计6/12小时累计降水约${rain6.toFixed(0)}/${rain12.toFixed(0)} mm。`, action: "加固门窗和临时设施，交通、学校和工地进入防台准备。", leadHours: 24, sourceNote };
    if ((within24?.wind || 0) >= 10.8 || (gust24?.gust || 0) >= 17.2 || rain24 >= 100 || rain12 >= 50) return { id: "cn-blue", severity: 1, label: "台风蓝色预警", authority: mainlandAuthority, reason: `未来24小时可能受热带气旋外围风雨影响；预计12/24小时累计降水约${rain12.toFixed(0)}/${rain24.toFixed(0)} mm。`, action: "关注预报更新，海上、高空作业和易涝区域提前做好防风防汛准备。", leadHours: 24, sourceNote };
    return none();
  }

  if (region === "hongkong" || region === "macau") {
    const office = region === "hongkong" ? "模拟香港天文台" : "模拟澳门地球物理气象局";
    const max6 = within6?.wind || 0;
    const max12 = within12?.wind || 0;
    const max24 = within24?.wind || 0;
    if (max6 >= 32.8 && (closest6?.distanceKm || 999) < 180) return { id: `${region}-10`, severity: 5, label: "十号飓风信号", authority: office, reason: `未来数小时预计飓风程度持续风影响本地，中心最近约${Math.round(closest6?.distanceKm || 0)} km。`, action: "留在坚固室内远离门窗，所有非必要交通与户外活动停止。", leadHours: 6, sourceNote };
    if (max6 >= 28 && (closest6?.distanceKm || 999) < 170 && ty.vmax >= 41.5) return { id: `${region}-9`, severity: 4, label: "九号烈风或暴风风力增强信号", authority: office, reason: "未来数小时烈风或暴风预计显著增强，强台风核心可能近距离掠过。", action: "立即完成最后防风措施，不要外出。", leadHours: 6, sourceNote };
    if (max12 >= 17.5) {
      const dir = warningDirection(station, within12 || impacts[0], ty);
      return { id: `${region}-8`, severity: 3, label: `八号${dir}向烈风或暴风信号`, authority: office, reason: `未来约12小时本地持续风可能达到烈风或暴风程度，峰值约${max12.toFixed(1)} m/s。`, action: "停课停工安排进入执行阶段，公共交通逐步收缩。", leadHours: 12, sourceNote };
    }
    if (max24 >= 11.4) return { id: `${region}-3`, severity: 2, label: "三号强风信号", authority: office, reason: `未来24小时本地可能普遍出现强风，最大持续风约${max24.toFixed(1)} m/s。`, action: "收好户外物品，减少沿岸及高地活动。", leadHours: 24, sourceNote };
    if ((closest36?.distanceKm || 9999) <= 800) return { id: `${region}-1`, severity: 1, label: "一号戒备信号", authority: office, reason: `热带气旋未来路径进入约800 km戒备范围，最近距离约${Math.round(closest36?.distanceKm || 0)} km。`, action: "检查防风物资并关注信号升级可能。", leadHours: 36, sourceNote };
    return none("未悬挂热带气旋信号");
  }

  if (region === "taiwan") {
    const landThreat = impacts.find((i) => i.leadHour <= 18 && i.distanceKm <= i.r7);
    const seaThreat = impacts.find((i) => i.leadHour <= 24 && i.distanceKm <= i.r7 + 100);
    if (landThreat) return { id: "tw-land", severity: 3, label: "海上陆上台风警报", authority: "模拟中央气象署", reason: `预计${Math.max(0, Math.round(landThreat.leadHour))}小时内7级风暴风范围可能影响本站城市。`, action: "完成防风、撤离和交通管制准备，山区与沿海提高警戒。", leadHours: 18, sourceNote };
    if (seaThreat) return { id: "tw-sea", severity: 2, label: "海上台风警报", authority: "模拟中央气象署", reason: `未来24小时7级风暴风范围可能进入邻近海域。`, action: "海上作业返港，持续留意是否扩大为陆上警报。", leadHours: 24, sourceNote };
    return none("无台风警报");
  }

  if (region === "philippines") {
    const table = [
      { n: 5, min: 51.3, lead: 12 }, { n: 4, min: 32.7, lead: 12 }, { n: 3, min: 24.5, lead: 18 },
      { n: 2, min: 17.2, lead: 24 }, { n: 1, min: 10.8, lead: 36 }
    ];
    for (const row of table) {
      const hit = maxWithin(impacts, row.lead, "wind");
      if ((hit?.wind || 0) >= row.min) return { id: `ph-${row.n}`, severity: row.n, label: `TCWS #${row.n}`, authority: "PAGASA (SIMULATED)", reason: `Within ${row.lead} hours, local sustained winds may reach about ${hit?.wind.toFixed(1)} m/s.`, action: row.n >= 4 ? "Take highest-level protective action, suspend non-essential travel, and evacuate high-risk communities as directed." : row.n >= 2 ? "Secure homes and utilities, prepare for transport disruption, and avoid non-essential travel." : "Begin wind preparations and monitor subsequent bulletins.", leadHours: row.lead, sourceNote };
    }
    return none("NO ACTIVE TCWS");
  }

  if (region === "korea") {
    // KMA heavy-rain criteria use either a 6 h or 12 h accumulation.  Keep the
    // forecast-path warning engine aligned with those paired thresholds rather
    // than deriving a single looser 12 h proxy.
    const projectedAccumulation = (hours: number) => impacts
      .filter((i) => i.leadHour <= hours)
      .reduce((sum, i, idx, arr) => {
        const nextLead = arr[idx + 1]?.leadHour ?? Math.min(hours, i.leadHour + 3);
        const span = Math.max(0.5, Math.min(3, nextLead - i.leadHour));
        return sum + Math.max(0, i.rainRate) * span;
      }, 0);
    const rain6 = projectedAccumulation(6);
    const rain12 = projectedAccumulation(12);
    const warningRain = rain6 >= 110 || rain12 >= 180;
    const advisoryRain = rain6 >= 70 || rain12 >= 110;
    if ((within24?.wind || 0) >= 21 || (gust24?.gust || 0) >= 26 || warningRain) return { id: "kr-warning", severity: 3, label: "태풍경보", authority: "기상청 (모의)", reason: `강풍·호우 경보 수준이 예상됩니다. 평균풍속 ${(within24?.wind || 0).toFixed(1)} m/s, 순간풍속 ${(gust24?.gust || 0).toFixed(1)} m/s, 6/12시간 강수량 약 ${rain6.toFixed(0)}/${rain12.toFixed(0)} mm.`, action: "산간·해안과 교통시설에 대한 높은 단계의 방재 대응을 시행하십시오.", leadHours: 24, sourceNote };
    if ((within24?.wind || 0) >= 14 || (gust24?.gust || 0) >= 20 || advisoryRain) return { id: "kr-advisory", severity: 2, label: "태풍주의보", authority: "기상청 (모의)", reason: `강풍 또는 호우 주의보 수준이 예상됩니다. 6/12시간 강수량 약 ${rain6.toFixed(0)}/${rain12.toFixed(0)} mm.`, action: "옥외 시설물을 고정하고 교통·산지 침수 위험을 확인하십시오.", leadHours: 24, sourceNote };
    return none("태풍특보 없음");
  }

  if (region === "japan") {
    const closest = closestWithin(impacts, 24);
    const okinawa = station.lat < 30.5;
    const emergency = (closest?.distanceKm || 999) < 260 && (ty.pmin <= (okinawa ? 910 : 930) || ty.vmax >= (okinawa ? 60 : 50));
    if (emergency) return { id: "jp-emergency", severity: 5, label: "暴風特別警報（シミュレーション）", authority: "気象庁（シミュレーション）", reason: "非常に強い台風が近距離で影響し、特別警報相当の危険度が予想されます。", action: "直ちに最大限の安全確保を行い、海岸・河川・崖・脆弱な建物から離れてください。", leadHours: 12, sourceNote };
    if ((within24?.wind || 0) >= 20) return { id: "jp-storm", severity: 3, label: "暴風警報（シミュレーション）", authority: "気象庁（シミュレーション）", reason: `本地域では最大風速約${within24?.wind.toFixed(1)} m/sの暴風が予想されます。`, action: "不要不急の外出を控え、交通機関・避難情報を確認してください。", leadHours: 24, sourceNote };
    if ((within24?.wind || 0) >= 13.9) return { id: "jp-advisory", severity: 1, label: "強風注意報（シミュレーション）", authority: "気象庁（シミュレーション）", reason: "台風周辺の強風が注意報基準に達する見込みです。", action: "屋外の物を固定し、最新の気象情報を確認してください。", leadHours: 24, sourceNote };
    return none("台風に関する警報・注意報なし");
  }

  if ((within24?.wind || 0) >= 32.7) return { id: "generic-red", severity: 4, label: "极端台风警报", authority: "模拟城市应急气象中心", reason: "未来24小时存在飓风级近地风风险。", action: "进入紧急避险状态。", leadHours: 24, sourceNote };
  if ((within24?.wind || 0) >= 24.5) return { id: "generic-orange", severity: 3, label: "严重台风警报", authority: "模拟城市应急气象中心", reason: "未来24小时存在破坏性强风。", action: "停止高风险户外活动。", leadHours: 24, sourceNote };
  if ((within24?.wind || 0) >= 13.9) return { id: "generic-yellow", severity: 2, label: "热带气旋警报", authority: "模拟城市应急气象中心", reason: "未来路径可能带来强风和强降雨。", action: "做好防风防汛准备。", leadHours: 24, sourceNote };
  return none();
}


function operationalWarningLabel(region: WarningRegion, severity: number, truthLabel: string): string {
  if (severity <= 0) {
    if (region === "philippines") return "NO ACTIVE TCWS";
    if (region === "japan") return "台風に関する警報・注意報なし";
    if (region === "korea") return "태풍특보 없음";
    if (region === "hongkong" || region === "macau") return "未悬挂热带气旋信号";
    if (region === "taiwan") return "無颱風警報";
    return "无台风预警";
  }
  if (region === "philippines") return `TCWS #${Math.max(1, Math.min(5, severity))}`;
  if (region === "japan") return severity >= 5 ? "暴風特別警報（シミュレーション）" : severity >= 3 ? "暴風警報（シミュレーション）" : "強風注意報（シミュレーション）";
  if (region === "korea") return severity >= 3 ? "태풍경보" : "태풍주의보";
  if (region === "mainland") return severity >= 4 ? "台风红色预警" : severity === 3 ? "台风橙色预警" : severity === 2 ? "台风黄色预警" : "台风蓝色预警";
  if (region === "hongkong" || region === "macau") return severity >= 5 ? "十号飓风信号" : severity >= 4 ? "九号烈风或暴风风力增强信号" : severity >= 3 ? "八号烈风或暴风信号" : severity >= 2 ? "三号强风信号" : "一号戒备信号";
  if (region === "taiwan") return severity >= 3 ? "海上陸上颱風警報" : "海上颱風警報";
  return severity >= 4 ? "极端台风警报" : severity >= 3 ? "严重台风警报" : severity >= 2 ? "热带气旋警报" : truthLabel;
}

function warningAuthorityForRegion(region: WarningRegion, station: PublicAreaStation): string {
  if (region === "philippines") return "PAGASA (SIMULATED)";
  if (region === "japan") return "気象庁（シミュレーション）";
  if (region === "korea") return "기상청 (모의)";
  if (region === "taiwan") return "中央氣象署（模擬）";
  if (region === "hongkong") return "香港天文台（模擬）";
  if (region === "macau") return "地球物理氣象局（模擬）";
  if (region === "mainland") return localMeteorologicalAuthority(station);
  return "模拟城市应急气象中心";
}

function buildObservedWarningOverride(
  ty: Typhoon,
  station: PublicAreaStation,
  region: WarningRegion,
  sourceNote: string,
  impacts: ForecastImpact[],
  reading?: StationReading
): WarningStatus | null {
  const obsWind = Math.max(0, Number(reading?.windSpeed || 0));
  const obsGust = Math.max(0, Number(reading?.gustSpeed || 0));
  const closest = impacts.length ? impacts.reduce((a, b) => b.distanceKm < a.distanceKm ? b : a) : undefined;
  const closest3 = closestWithin(impacts, 3) || closestWithin(impacts, 6) || closest;
  const distanceKm = Number(closest3?.distanceKm || closest?.distanceKm || Infinity);
  const r7 = Math.max(0, Number(closest3?.r7 || 0));
  const r10 = Math.max(0, Number(closest3?.r7 || 0) * 0.62);
  const insideR7 = Number.isFinite(distanceKm) && distanceKm <= Math.max(35, r7);
  const insideR10 = Number.isFinite(distanceKm) && distanceKm <= Math.max(24, r10);
  const nearCore = Number.isFinite(distanceKm) && distanceKm <= Math.max(18, Number(ty.rmw || 24));
  let severity = 0;
  if (region === "hongkong" || region === "macau") {
    if (obsWind >= 32.8 || obsGust >= 41.5 || (insideR10 && ty.vmax >= 41.5)) severity = 5;
    else if (obsWind >= 28 || (insideR10 && ty.vmax >= 32.7)) severity = 4;
    else if (obsWind >= 17.5 || obsGust >= 24.5 || insideR7) severity = 3;
    else if (obsWind >= 11.4 || obsGust >= 17.2) severity = 2;
    else if (distanceKm <= 800) severity = 1;
  } else if (region === "taiwan") {
    if (insideR7 || obsWind >= 17.2 || obsGust >= 24.5) severity = 3;
    else if (distanceKm <= Math.max(r7 + 100, 150) || nearCore || obsWind >= 10.8) severity = 2;
  } else if (region === "philippines") {
    const refWind = Math.max(obsWind, obsGust * 0.82, Number(closest3?.wind || 0));
    if (refWind >= 51.3) severity = 5;
    else if (refWind >= 32.7) severity = 4;
    else if (refWind >= 24.5) severity = 3;
    else if (refWind >= 17.2 || insideR10) severity = 2;
    else if (refWind >= 10.8 || insideR7) severity = 1;
  } else if (region === "korea") {
    if (obsWind >= 21 || obsGust >= 26 || insideR10) severity = 3;
    else if (obsWind >= 14 || obsGust >= 20 || insideR7) severity = 2;
  } else if (region === "japan") {
    const okinawa = station.lat < 30.5;
    if ((distanceKm < 260 && (ty.pmin <= (okinawa ? 910 : 930) || ty.vmax >= (okinawa ? 60 : 50))) || obsWind >= 30) severity = 5;
    else if (obsWind >= 20 || obsGust >= 26 || insideR10) severity = 3;
    else if (obsWind >= 13.9 || obsGust >= 20 || insideR7) severity = 1;
  } else {
    if (obsWind >= 32.7 || obsGust >= 41.5) severity = 4;
    else if (obsWind >= 24.5 || obsGust >= 32.7 || insideR10) severity = 3;
    else if (obsWind >= 17.2 || obsGust >= 24.5 || insideR7) severity = 2;
    else if (obsWind >= 10.8 || obsGust >= 17.2 || nearCore) severity = 1;
  }
  if (severity <= 0) return null;
  const label = operationalWarningLabel(region, severity, operationalWarningLabel(region, severity, ""));
  return {
    id: `${region}-obs-${severity}`,
    severity,
    label,
    authority: warningAuthorityForRegion(region, station),
    reason: `近距实况/短临诊断触发兜底：站点当前平均风约${obsWind.toFixed(1)} m/s，阵风约${obsGust.toFixed(1)} m/s，台风中心最近约${Math.round(distanceKm)} km${insideR7 ? '，已进入七级风圈影响范围' : ''}${insideR10 ? '，并接近暴风圈' : ''}。`,
    action: region === "philippines"
      ? "Treat the local threat as active even if the formal bulletin lags, and follow evacuation / local disaster instructions immediately."
      : region === "japan"
      ? "正式発表が遅れていても、既に危険域です。避難情報・交通情報を優先して安全確保を行ってください。"
      : region === "korea"
      ? "공식 전파가 지연되더라도 이미 위험 구역입니다. 즉시 방재 조치와 대피 준비를 시행하십시오."
      : region === "taiwan"
      ? "即使正式警報稍有延遲，也應視為本地已受颱風影響，立即完成防風與避難措施。"
      : "即使正式公告稍有延迟，也应按本地已受台风影响处理，立即执行防风、避险和停运准备。",
    leadHours: Math.max(0, Math.round(Number(closest3?.leadHour || 0))),
    sourceNote: `${sourceNote} 近距实况兜底：当站点已进入风圈或实测风达到区域门槛时，禁止出现“眼前无预警”的缺报。`
  };
}

function operationalMessage(region: WarningRegion, anomaly: WarningOperationalOutcome["anomaly"], delayHours: number): { reason: string; action: string } {
  if (region === "philippines") {
    if (anomaly === "false_alarm") return { reason: "A precautionary wind signal was issued from uncertain forecast guidance; later guidance may revise it.", action: "Continue normal preparedness while monitoring subsequent simulated PAGASA bulletins." };
    if (anomaly === "underreported") return { reason: "The public signal is lower than the simulator's underlying hazard estimate because of classification and communication uncertainty.", action: "Do not rely on the signal number alone; monitor local wind, rainfall and evacuation instructions." };
    return { reason: `No active public signal has been disseminated yet; simulated warning-system latency is about ${delayHours.toFixed(1)} h.`, action: "Continue monitoring weather conditions and local disaster-risk-reduction instructions." };
  }
  if (region === "japan") {
    if (anomaly === "false_alarm") return { reason: "予測の不確実性により予防的な注意報が発表されています。", action: "今後のシミュレーション情報を確認してください。" };
    if (anomaly === "underreported") return { reason: "観測・判定・伝達の不確実性により、公表された警戒レベルが基礎危険度より低くなっています。", action: "警報種別だけでなく風雨と自治体情報を確認してください。" };
    return { reason: `警報伝達の遅れをシミュレーションしています（約${delayHours.toFixed(1)}時間）。`, action: "気象状況と自治体の防災情報を継続して確認してください。" };
  }
  if (region === "korea") {
    if (anomaly === "false_alarm") return { reason: "예측 불확실성으로 예방적 특보가 발표된 모의 상황입니다.", action: "후속 모의 기상정보를 계속 확인하십시오." };
    if (anomaly === "underreported") return { reason: "관측·판정·전파의 불확실성으로 공표 특보가 실제 모의 위험도보다 낮습니다.", action: "특보 단계뿐 아니라 실제 풍우와 지자체 안내를 확인하십시오." };
    return { reason: `모의 경보 전달 지연이 약 ${delayHours.toFixed(1)}시간 발생했습니다.`, action: "기상 상황과 재난 안내를 계속 확인하십시오." };
  }
  if (region === "taiwan") {
    if (anomaly === "underreported") return { reason: "受觀測、研判或傳遞不確定性影響，公開警戒層級低於模式基礎風險。", action: "勿僅依賴警報層級，持續留意風雨實況與地方避難資訊。" };
    if (anomaly === "false_alarm") return { reason: "因預報不確定性發布預防性警報，後續資料可能調整。", action: "持續注意後續模擬警報。" };
    return { reason: `模擬警報傳遞約延遲${delayHours.toFixed(1)}小時。`, action: "持續留意風雨與地方防災資訊。" };
  }
  if (anomaly === "underreported") return { reason: "受监测、研判或信息传递能力影响，当前公开预警等级低于模型基础危险度。", action: "不要只依赖预警等级，继续关注实况、后续预报和当地应急指令。" };
  if (anomaly === "false_alarm") return { reason: "受预报不确定性影响发布了预防性预警，后续研判可能调整。", action: "保持常规防范并关注后续模拟公告。" };
  return { reason: `模拟预警系统存在约${delayHours.toFixed(1)}小时的信息发布/传递延迟。`, action: "继续关注风雨实况和当地应急信息。" };
}

/** Public warning after regional detection/classification/dissemination imperfections are applied. */
export function buildPrimaryWarning(ty: Typhoon, station: PublicAreaStation, reading?: StationReading): WarningStatus {
  const region = getWarningRegion(station.city || station.name, station.lat, station.lon);
  const impacts = buildForecastImpacts(ty, station, reading);
  const truthBase = buildIdealPrimaryWarning(ty, station, reading);
  const observedOverride = truthBase.severity <= 0 ? buildObservedWarningOverride(ty, station, region, truthBase.sourceNote, impacts, reading) : null;
  const truth = observedOverride || truthBase;
  const closest = impacts.length ? impacts.reduce((a, b) => b.distanceKm < a.distanceKm ? b : a) : undefined;
  const profile = getDisasterCapabilityProfile(station.lat, station.lon, station.country);
  const closeRangeLock = !!observedOverride || (!!closest && truth.severity >= 2 && (closest.distanceKm <= Math.max(40, Number((closest as any).r7 || 0)) || Math.max(Number(reading?.windSpeed || 0), Number(reading?.gustSpeed || 0) * 0.82) >= 14));
  const outcome = evaluateWarningOperationalOutcome({
    profile,
    eventKey: `${ty.id}:${publicAreaSeed(station)}:${region}`,
    truthSeverity: truth.severity,
    nominalLeadHours: truth.leadHours,
    closestThreatLeadHours: closest?.leadHour,
    closestThreatDistanceKm: closest?.distanceKm
  });

  if (closeRangeLock || outcome.anomaly === "none") {
    return { ...truth, truthSeverity: truth.severity, operationalAnomaly: "none", issueDelayHours: closeRangeLock ? 0 : outcome.issueDelayHours };
  }

  const reportedSeverity = outcome.reportedSeverity;
  const message = operationalMessage(region, outcome.anomaly, outcome.issueDelayHours);
  const label = operationalWarningLabel(region, reportedSeverity, truth.label);
  const sourceNote = `${truth.sourceNote} 模拟公共预警系统：${profile.label}，本次状态=${outcome.anomaly}，估算发布/传递延迟${outcome.issueDelayHours.toFixed(1)}h。`;
  return {
    ...truth,
    id: `${truth.id}-ops-${outcome.anomaly}`,
    severity: reportedSeverity,
    label,
    reason: message.reason,
    action: message.action,
    truthSeverity: truth.severity,
    operationalAnomaly: outcome.anomaly,
    issueDelayHours: outcome.issueDelayHours,
    sourceNote
  };
}

export function buildCurrentWarnings(ty: Typhoon, station: PublicAreaStation, reading?: StationReading, waterDepthCm = 0, rain6h = 0): WarningStatus[] {
  const primary = buildPrimaryWarning(ty, station, reading);
  const region = getWarningRegion(station.name, station.lat, station.lon);
  const sourceNote = OFFICIAL_RULE_NOTES[region];
  const result = [primary];
  const rain = Number(reading?.precipitation || 0);
  const surge = Number(reading?.stormSurge || 0);
  if (rain >= 50 || rain6h >= 140) result.push({ id: "rain-red", severity: 4, label: "暴雨高风险警报（模拟）", authority: "城市防汛指挥系统", reason: `当前小时雨强${rain.toFixed(1)} mm/h，近6小时约${rain6h.toFixed(0)} mm。`, action: "远离下穿隧道、河道和低洼地，地下空间做好封控。", sourceNote: "按短历时强降雨和城市积涝风险联合判定。" });
  else if (rain >= 25 || rain6h >= 80) result.push({ id: "rain-orange", severity: 3, label: "暴雨与内涝警戒（模拟）", authority: "城市防汛指挥系统", reason: "短时强降雨可能超过局地排水能力。", action: "易涝路段提前布置排水和交通疏导。", sourceNote: "按短历时强降雨和城市积涝风险联合判定。" });
  if (waterDepthCm >= 35) result.push({ id: "flood-high", severity: 4, label: "严重积水风险", authority: "城市应急管理系统", reason: `模型估算典型低洼路面积水约${waterDepthCm.toFixed(0)} cm。`, action: "封闭深积水路段和地下通道，车辆不要强行涉水。", sourceNote: "基于城市排水能力、近6小时降水、地势和风暴增水回顶估算。" });
  else if (waterDepthCm >= 15) result.push({ id: "flood-med", severity: 2, label: "城市积水提示", authority: "城市应急管理系统", reason: `模型估算低洼点积水约${waterDepthCm.toFixed(0)} cm。`, action: "避开低洼道路和下穿通道。", sourceNote: "基于城市排水能力、近6小时降水、地势和风暴增水回顶估算。" });
  if (surge >= 1.2) result.push({ id: "surge", severity: 4, label: "风暴潮高风险", authority: "沿海防潮系统", reason: `当前模拟风暴增水${surge.toFixed(2)} m。`, action: "滨海低地、码头和海堤外侧人员撤离。", sourceNote: "模拟风暴增水，不含天文潮。" });
  return result.slice(0, 4);
}

const HIGH_CAPACITY = new Set(["上海", "深圳", "广州", "香港", "澳门", "东京", "大阪", "首尔", "北京", "杭州", "南京", "台北", "新加坡"]);
const LOWLAND = new Set(["上海", "宁波", "海口", "湛江", "北海", "珠海", "澳门", "广州", "深圳", "马尼拉", "高雄", "台南", "海防"]);
export function getInfrastructureProfile(cityRaw: string): InfrastructureProfile {
  const city = cityOnlyName(cityRaw);
  const seeded = deterministic01(`${city}:infrastructure`);
  let index = 0.56 + seeded * 0.18;
  if (HIGH_CAPACITY.has(city)) index += 0.14;
  if (LOWLAND.has(city)) index -= 0.04;
  index = Math.max(0.42, Math.min(0.92, index));
  return {
    index,
    drainageMmPerHour: 22 + index * 46,
    lowlandFactor: LOWLAND.has(city) ? 1.22 : 0.94 + deterministic01(`${city}:terrain`) * 0.20,
    label: index >= 0.8 ? "较强" : index >= 0.65 ? "中上" : index >= 0.52 ? "中等" : "偏弱"
  };
}

export function recentRain(history: StationHistoryDatum[], currentHour: number, hours: number): number {
  return history.filter((d) => d.time > currentHour - hours - 1e-6 && d.time <= currentHour + 1e-6)
    .reduce((sum, d) => sum + Math.max(0, Number(d.precipitation || 0)), 0);
}

export function estimateWaterloggingDepthCm(city: string, reading: StationReading | undefined, history: StationHistoryDatum[], currentHour: number): number {
  const profile = getInfrastructureProfile(city);
  const rain1 = Math.max(0, Number(reading?.precipitation || 0));
  const rain3 = recentRain(history, currentHour, 3);
  const rain6 = recentRain(history, currentHour, 6);
  const capacity = profile.drainageMmPerHour;
  const shortBurstExcess = Math.max(0, rain1 - capacity * 0.72) * 0.72;
  const threeHourExcess = Math.max(0, rain3 - capacity * 3 * 0.62) * 0.24;
  const sixHourSaturation = Math.max(0, rain6 - capacity * 6 * 0.44) * 0.12;
  const surgeBackwater = Math.max(0, Number(reading?.stormSurge || 0) - 0.45) * 16;
  const depth = (shortBurstExcess + threeHourExcess + sixHourSaturation) * 0.42 * profile.lowlandFactor + surgeBackwater;
  return Math.max(0, Math.min(180, depth));
}

const AIRPORTS: Record<string, string> = {
  香港: "香港国际机场", 澳门: "澳门国际机场", 上海: "上海浦东/虹桥机场", 深圳: "深圳宝安机场", 广州: "广州白云机场", 珠海: "珠海金湾机场",
  厦门: "厦门高崎机场", 福州: "福州长乐机场", 温州: "温州龙湾机场", 杭州: "杭州萧山机场", 宁波: "宁波栎社机场", 海口: "海口美兰机场",
  三亚: "三亚凤凰机场", 台北: "桃园/松山机场", 高雄: "高雄国际机场", 东京: "羽田/成田机场", 大阪: "关西/伊丹机场", 那霸: "那霸机场",
  首尔: "仁川/金浦机场", 釜山: "金海机场", 济州: "济州机场", 马尼拉: "尼诺伊·阿基诺国际机场", 宿务: "麦克坦-宿务机场", 岘港: "岘港国际机场",
  胡志明: "新山一国际机场", 北京: "首都/大兴机场", 南京: "南京禄口机场", 武汉: "武汉天河机场", 长沙: "长沙黄花机场", 青岛: "青岛胶东机场"
};

// District-specific airport association where one metropolitan area has multiple airports or the
// airport is physically tied to a particular district. Other districts fall back to the city's
// primary airport while their *status* is still calculated from the shared district hazard anchor.
const DISTRICT_AIRPORTS: Record<string, string> = {
  "浦东新区": "上海浦东国际机场", "长宁区": "上海虹桥国际机场", "闵行区": "上海虹桥国际机场",
  "大兴区": "北京大兴国际机场", "顺义区": "北京首都国际机场", "宝安区": "深圳宝安国际机场",
  "白云区": "广州白云国际机场", "萧山区": "杭州萧山国际机场", "江宁区": "南京禄口国际机场",
  "龙湾区": "温州龙湾国际机场", "长乐区": "福州长乐国际机场", "翔安区": "厦门翔安国际机场",
  "湖里区": "厦门高崎国际机场", "美兰区": "海口美兰国际机场", "金湾区": "珠海金湾机场",
  "胶州市": "青岛胶东国际机场", "天河区": "广州白云国际机场", "新郑市": "郑州新郑国际机场",
  "黄陂区": "武汉天河国际机场", "长沙县": "长沙黄花国际机场", "双流区": "成都双流国际机场",
  "简阳市": "成都天府国际机场"
};

export function getAirportStatus(cityRaw: string, impacts: ForecastImpact[], reading?: StationReading, districtRaw?: string) {
  const city = cityOnlyName(cityRaw);
  const district = String(districtRaw || "").replace(/^.*?市(?=[^市]+$)/, "");
  const airport = DISTRICT_AIRPORTS[district] || AIRPORTS[city] || `${city}区域主要机场`;
  const next12 = impacts.filter((i) => i.leadHour <= 12);
  const wind = Math.max(Number(reading?.windSpeed || 0), ...next12.map((i) => i.wind), 0);
  const gust = Math.max(Number(reading?.gustSpeed || 0), ...next12.map((i) => i.gust), 0);
  const rain = Math.max(Number(reading?.precipitation || 0), ...next12.map((i) => i.rainRate), 0);
  if (wind >= 28 || gust >= 38 || rain >= 55) return { airport, level: 4, status: "大面积停航/关闭准备", detail: "跑道运行和地勤作业已进入高风险条件，模拟建议停止大部分航班起降。" };
  if (wind >= 22 || gust >= 30 || rain >= 35) return { airport, level: 3, status: "大面积延误与取消", detail: "强侧风、雷雨或低能见度将显著降低机场容量。" };
  if (wind >= 15 || gust >= 22 || rain >= 18) return { airport, level: 2, status: "流量限制/部分延误", detail: "机场进入台风运行模式，部分航班可能备降、延误或提前取消。" };
  return { airport, level: 0, status: "运行基本正常", detail: "暂未达到显著影响机场运行的模拟阈值。" };
}

export function getPreparednessProgress(ty: Typhoon, warning: WarningStatus, airportLevel: number): number {
  const modelPrepared = Math.max(0, Math.min(1, Number(ty.preparednessIndex ?? 0.45)));
  const urgency = Math.min(1, warning.severity / 4);
  const transport = Math.min(1, airportLevel / 4);
  const operationalPenalty = warning.operationalAnomaly === "missed" ? 0.22
    : warning.operationalAnomaly === "delayed" ? 0.15
      : warning.operationalAnomaly === "underreported" ? 0.10
        : warning.operationalAnomaly === "false_alarm" ? 0.04 : 0;
  return Math.round(Math.max(8, Math.min(100, 100 * (0.38 + 0.42 * modelPrepared + 0.16 * urgency + 0.04 * transport - operationalPenalty))));
}

const EVENT_LIBRARY = {
  flood: [
    "低洼道路出现连片积水，排水泵站提升运行负荷。", "一处下穿通道水位快速上涨，交警临时封闭入口并引导车辆绕行。", "老旧小区雨水口接近满负荷，社区组织清障和移动排水。",
    "沿河道路局部出现积水，防汛人员布设警戒线并加密巡查。", "地下车库入口加装挡水板，物业安排人员持续值守。", "商业街局部积水影响通行，市政抢排设备到场作业。",
    "医院周边易涝点启用移动泵车，保障急救车辆通行。", "高架匝道低洼处积水加深，交管部门实施临时限行。", "暴雨核心扫过后，多处积水点被纳入分级处置清单。",
    "部分社区道路短时积水超过路缘石高度，网格员提醒居民避免涉水。", "雨势减弱后主干路积水开始回落，但支路排水仍较缓慢。", "局地排水口受到河网高水位顶托，积水消退速度明显下降。"
  ],
  surge: [
    "沿海潮位受风暴增水推高，海堤和闸口巡查频次加密。", "港池水位明显抬升，非必要装卸和近岸作业暂停。", "滨海低洼道路实施预防性封闭并布置警戒。",
    "渔港船只完成二次系固，沿岸作业人员撤离至安全位置。", "大浪叠加增水造成局部越浪，海堤外侧道路停止通行。", "河口闸门转入防潮调度，低洼片区检查防倒灌设施。",
    "港区浮码头暂停使用，设备向高处转移。", "近岸客运航线停航，观浪点和亲水平台封闭。", "滨海地下空间启动防倒灌措施，出入口加装临时挡水设施。",
    "潮位回落速度慢于预期，沿海排涝泵站继续维持高负荷运行。"
  ],
  landslide: [
    "持续强降雨使山坡土体趋于饱和，地质灾害风险上升。", "山区道路出现零星落石，养护部门巡查清障。", "山谷溪流水位快速上涨，登山线路和涉溪景点关闭。",
    "高边坡监测位移增大，附近住户进入转移准备。", "山洪沟流量快速增加，沿沟居民点设置临时警戒。", "连续降雨后出现小规模边坡滑塌，公路实行单幅通行。",
    "山区村落收到地质灾害转移提示，老弱人员优先撤离。", "切坡建房和高陡边坡被列为重点巡查对象。", "溪谷洪水夹带泥沙，临时桥梁和涉水便道停止通行。",
    "局部山体出现渗水和小规模裂缝扩展，监测人员加密观测。"
  ],
  dam: [
    "上游水库入库流量陡增，管理单位加密坝体与泄洪设施巡检。", "一座小型水库进入高水位运行区间，开始预泄调度。", "山塘出现漫顶风险提示，抢险队携带土工材料前往布防。",
    "极端降雨背景下出现小型坝体险情报告，周边低洼居民点组织预防性转移。", "溢洪道持续高负荷运行，下游河道进入警戒状态。", "山塘局部渗漏和坝坡冲刷加重，抢险人员降低库水位。",
    "水库上游来水超过常态调度能力，防汛部门扩大下游巡查范围。", "一处塘坝排水设施发生故障，移动泵组和应急电源到场处置。",
    "极端小概率情景触发小型坝体局部溃口，模拟系统立即启动下游最高级别转移和河道封控。"
  ],
  wind: [
    "强风导致零星树木倒伏，园林和消防力量开始处置。", "广告设施和高空构筑物进入重点巡检，部分工地塔吊停止作业。", "局部配电线路受风影响跳闸，电力抢修队伍前置待命。",
    "开放式高架和桥梁侧风增强，部分车型限速或限制通行。", "阵风掀落轻质屋面和临时围挡，消防接到排险任务。", "高层建筑局地风压增强，物业提醒住户远离窗边。",
    "路旁大型树枝折断影响通行，市政队伍分区清障。", "港口起重设备停止作业并完成防台锚定。", "建筑工地脚手架和临时板房加固检查升级。",
    "局部玻璃幕墙和外立面附属物出现松动报告，周边区域设置安全警戒。"
  ],
  power: [
    "局部架空线路受倒树和飘挂物影响跳闸，抢修队伍分片巡线。", "配电站启动防涝值守，移动发电车前置至重要用户附近。", "个别街区短时停电，电力部门优先保障医院、泵站和通信机房。",
    "强风使电网故障报修量上升，非核心区域复电时间有所延长。", "地下配电设施周边积水加深，供电单位实施预防性断电保护。", "主要供电线路运行正常，但抢修力量保持一级备勤。",
    "雨势减弱后开始集中处理倒杆、断线和树障，重点用户逐步恢复供电。", "应急发电设备向安置点和排涝泵站调拨。"
  ],
  metro: [
    "地铁低洼出入口加设挡水设施，部分出入口临时关闭。", "轨道交通对地面区段实施限速，部分线路延长行车间隔。", "易受积水影响的车站启动防汛封堵，工作人员引导乘客改走高位出入口。",
    "公交线路绕开积水路段，部分站点临时取消停靠。", "城市快速路匝道因横风和积水实施交通管制。", "地下通道积水预警触发，运营方安排人员现场值守。",
    "雨势增强期间轨道交通准备采取区段停运，接驳公交同步待命。", "部分共享交通服务暂停向高风险区域投放车辆。"
  ],
  school: [
    "教育部门通知学校停止户外活动，并做好提前放学或停课准备。", "中小学和幼儿园启动防台值守，校舍重点检查门窗、屋面和排水设施。", "高等级预警生效后，区内学校转入停课状态并暂停线下培训活动。",
    "学校体育场馆和临时建筑停止使用，寄宿学生安排在安全区域集中管理。", "教育部门提醒家长避免在风雨最强时段接送学生。", "预警降级后，学校开始检查校舍安全和周边积水，符合条件后分批复课。"
  ],
  construction: [
    "高空作业全面暂停，塔吊回转至安全状态并加固临时设施。", "深基坑和地下工程加强排水，施工单位安排专人巡查边坡和支护。", "沿街围挡、脚手架和临建设施再次进行抗风检查。",
    "部分工地人员撤离临时板房，转移至永久建筑内避险。", "强降雨导致基坑水位快速上升，应急水泵连续运行。", "台风影响减弱后，工地暂不立即复工，先完成塔吊、脚手架和临电检查。"
  ],
  river: [
    "区内河网水位明显上涨，水闸和泵站转入联合调度。", "小河道接近警戒水位，沿河步道和亲水设施关闭。", "上游来水与本地暴雨叠加，部分支流出现快速涨水。",
    "河道漂浮物增多，水务人员清理闸口以保持行洪能力。", "部分圩区加强巡堤查险，薄弱堤段预置沙袋和抢险物资。", "雨势减弱后河网仍维持高水位，退水时间预计较长。"
  ],
  evacuation: [
    "危险房屋、工棚和低洼区域居民开始分批转移至临时安置点。", "沿海和河口高风险社区扩大人员转移范围，老幼病残人员优先。", "山区地质灾害隐患点启动预防性转移，村级干部逐户核查。",
    "安置点完成床位、饮水和应急照明检查，开始接收转移人员。", "部分已经转移的居民因风险仍高暂缓返回，社区继续提供生活保障。", "风险下降后启动分批返家，但危险房屋仍禁止进入。"
  ],
  medical: [
    "急救中心增加备勤车辆，重点保障积水片区和安置点医疗需求。", "医院启用防汛沙袋和移动泵，地下设备间加强巡查。", "部分社区卫生服务中心延长值守时间，为安置人员提供基础医疗服务。",
    "救护车根据积水和道路封控动态调整出车路线。", "应急药品、消毒用品和饮用水向受影响较重街道增配。", "灾后阶段开始开展环境消杀和饮水安全巡查。"
  ],
  telecom: [
    "通信运营商启动基站油机和电池巡检，重点保障应急指挥区域。", "个别基站因停电转入后备电源，网络总体保持可用。", "强风和积水导致少量通信故障，抢修人员待风力减弱后进入现场。",
    "安置点增设临时通信保障设备，提升人员密集区域容量。", "应急短信和小区广播持续推送防台提示。", "受损光缆和基站供电逐步恢复，通信保障转入灾后修复阶段。"
  ],
  supply: [
    "商超增加饮用水、方便食品和电池等应急物资补货。", "部分生鲜配送因道路管制延迟，保供车辆按应急通行方案运行。", "安置点生活物资开始按片区配送，重点保障老人和婴幼儿需求。",
    "农贸市场缩短营业时间，户外摊位提前撤场。", "主要生活必需品库存总体充足，相关部门加强价格和供应监测。", "风雨减弱后配送能力逐步恢复，积压订单分批处理。"
  ],
  response: [
    "应急救援队伍完成前置部署，冲锋舟、排水泵和发电设备到位。", "临时避难场所开放并开始接收转移人员。", "供电、通信、供水保障队伍进入值守状态。", "社区网格员逐户排查独居老人和危险房屋住户。",
    "消防、排水、交警和街道力量建立联合调度。", "受影响片区开始核查受灾人口和房屋损失，首批生活物资送往安置点。", "积水回落区域启动道路清障和电力复通。", "医疗力量向重点安置点增派人员。"
  ],
  shutdown: [
    "教育部门宣布高风险区域学校停课，校舍转入防风防汛值守。", "高风险户外工地和高空作业停工，塔吊、脚手架完成加固。", "部分企事业单位启动弹性停工安排，非必要人员居家办公。",
    "景区、码头和大型户外活动暂停开放并完成人员清场。", "公共交通进入特别班次，部分长途和水上客运暂停。", "高等级响应下，学校、工地和户外商业设施按风险分区采取停课停工措施。"
  ],
  drainage: [
    "区级排水调度中心上调泵站运行级别，易涝片区移动泵车开始轮换作业。", "部分雨水口被落叶和杂物堵塞，市政队伍按网格清障。", "河网高水位造成排水顶托，泵站改用强排模式。", "老城区合流制管网接近满负荷，防汛部门对重点街巷实施巡排。", "积水点退水速度慢于降雨减弱速度，排水力量继续值守。"
  ],
  tunnel: [
    "下穿隧道液位达到预警阈值，自动挡水设施和交通诱导同步启动。", "一处地下通道暂时封闭，人员由地面通道绕行。", "隧道泵房启动双泵运行并安排应急电源值守。", "积水回落后，隧道仍需完成电气和照明检查后再开放。"
  ],
  bridge: [
    "跨江跨海桥梁侧风增强，对大型客车、危化品车辆实施限速或临时禁行。", "桥面阵风明显高于城区平均风，交警启动分车型管控。", "风势减弱后桥梁仍维持限速，待巡检确认无坠物风险后逐步恢复。"
  ],
  port: [
    "港区停止非必要装卸，门机、岸桥完成锚定和防风锁闭。", "客运码头暂停靠泊，候船人员疏散至室内安全区域。", "锚地船舶加强值守，拖轮和应急船艇转入备勤。", "风浪减弱后港区先恢复应急作业，再评估商业装卸。"
  ],
  waterSupply: [
    "供水单位加强取水口浊度监测并提高净水药剂储备。", "局部低压区因停电和泵站切换出现短时水压波动，应急供水车待命。", "山洪夹带泥沙导致原水浊度快速上升，水厂调整处理工艺。", "供水主干系统总体稳定，抢修队重点巡查低洼阀门井。"
  ],
  gas: [
    "燃气部门对易积水调压设施开展巡查，地下阀井列入重点监测。", "倒树和建筑物受损区域同步排查燃气管线外力破坏风险。", "个别低洼燃气设施采取预防性停运，待积水退去后复检恢复。"
  ],
  elevator: [
    "高层住宅物业将低洼电梯降至安全层并关闭地下层停靠。", "部分楼宇因短时停电发生电梯困人警情，消防和维保人员处置。", "地下车库进水风险升高，物业暂停部分电梯进入地下层。"
  ],
  sanitation: [
    "环卫部门暂停高风险路段机械清扫，人员转入排水口清障。", "积水退去区域启动淤泥、倒伏枝叶和生活垃圾集中清运。", "安置点和受淹社区增加消杀频次，防范灾后环境卫生风险。"
  ],
  trees: [
    "行道树倒伏和断枝报警增加，园林抢险队按主干路优先级清障。", "老树和浅根树种在强风持续作用下风险升高，周边停车位临时封闭。", "风势减弱后园林部门继续排查悬挂断枝，避免次生坠落。"
  ],
  shelters: [
    "区内避难场所增开席位并补充饮水、折叠床和应急照明。", "部分安置点接收人数上升，社区增派社工和医疗志愿者。", "高风险社区转移人员继续留置，待水位和建筑安全评估后再返家。"
  ],
  agriculture: [
    "设施农业加固棚膜和骨架，低洼农田提前开沟排水。", "沿海养殖塘提高闸门和增氧设备巡查频次，防范漫塘与停电。", "强风造成部分果树落果和倒伏，农业部门开始统计损失并组织抢收。", "雨后农田积水较深，农技人员指导分区排涝和病害防控。"
  ],
  logistics: [
    "快递和即时配送缩减高风险片区服务，站点提前转移低位货物。", "城市保供车辆启用应急通行路线，优先配送安置点、医院和商超。", "高速入口管控导致部分干线物流延迟，仓储企业延长安全库存。"
  ],
  fireRescue: [
    "消防救援力量前置到易涝和老旧片区，舟艇、绳索和破拆装备完成检查。", "强风倒树、广告牌松动和人员被困类警情上升，消防实行分区调度。", "内涝最深时段，涉水救援力量重点保障医院、学校和安置点通道。"
  ],
  reservoir: [
    "区内小型水库和山塘加密水位监测，值守人员检查溢洪道和放水设施。", "上游来水快速增加，水库按调度方案预泄腾库。", "雨势减弱后仍维持高水位运行，坝体巡查和下游警戒继续。"
  ],
  coastalClosure: [
    "滨海公园、海滨步道和观浪平台全部关闭，入口设置硬隔离。", "沿岸低洼社区扩大防潮挡板布设范围，地下空间暂停开放。", "海水倒灌风险升高，滨海道路实施分段封控并安排潮位巡查。"
  ],
  guidance: [
    "提醒市民尽量留在室内，远离玻璃幕墙、广告牌和大树。", "不要驾车进入不明深度积水区域，地下车库注意倒灌风险。", "沿海人员远离海堤、沙滩和观浪点。", "山区居民留意山洪、滑坡和泥石流征兆。",
    "提前准备饮用水、常用药、充电设备和照明用品。", "不要在台风眼短暂平静时贸然外出。", "停电时关闭大功率电器并避免触碰积水中的电气设施。", "地下停车场车辆应根据通知提前转移至高处。",
    "发现河水突然暴涨、山体异响或裂缝扩大时立即撤离。", "台风过境后不要立即靠近受损广告牌、树木和临时建筑。"
  ]
};

export type DistrictRiskProfile = {
  urban: number;
  lowland: number;
  mountain: number;
  river: number;
  coastal: number;
  density: number;
};

function getDistrictRiskProfile(station: PublicAreaStation): DistrictRiskProfile {
  const key = publicAreaSeed(station);
  const city = publicAreaCity(station);
  const district = String(station.district || "");
  const seeded = (tag: string) => deterministic01(`${key}:${tag}`);
  let urban = 0.45 + seeded("urban") * 0.45;
  let lowland = 0.32 + seeded("lowland") * 0.48;
  let mountain = 0.15 + seeded("mountain") * 0.55;
  let river = 0.28 + seeded("river") * 0.52;
  let coastal = 0.12 + seeded("coastal") * 0.42;
  let density = 0.42 + seeded("density") * 0.48;
  if (["上海", "深圳", "广州", "珠海", "宁波", "温州", "厦门", "福州", "汕头", "湛江", "海口", "三亚", "香港", "澳门"].includes(city)) coastal += 0.30;
  if (["上海", "广州", "深圳", "武汉", "杭州", "南京", "宁波", "珠海", "海口"].includes(city)) lowland += 0.18;
  if (/(?:山|岭|峰|溪|谷)/.test(district) || ["福州", "温州", "宁德", "丽水", "台州", "龙岩", "惠州"].includes(city)) mountain += 0.20;
  if (/(?:浦|江|河|湖|湾|海|港|滨)/.test(district)) { river += 0.14; coastal += 0.12; }
  if (["上海", "深圳", "广州", "北京", "杭州", "南京", "武汉"].includes(city)) { urban += 0.12; density += 0.12; }
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { urban: clamp(urban), lowland: clamp(lowland), mountain: clamp(mountain), river: clamp(river), coastal: clamp(coastal), density: clamp(density) };
}

function eventPick(group: keyof typeof EVENT_LIBRARY, seed: string): string {
  const rows = EVENT_LIBRARY[group];
  return rows[Math.floor(deterministic01(seed) * rows.length) % rows.length];
}

function simpleSeverityFromWind(wind: number): number {
  if (wind >= 51.3) return 5;
  if (wind >= 32.7) return 4;
  if (wind >= 24.5) return 3;
  if (wind >= 17.2) return 2;
  if (wind >= 10.8) return 1;
  return 0;
}

function historicalWarningName(region: WarningRegion, severity: number): string {
  if (severity <= 0) return "台风预警";
  if (region === "hongkong" || region === "macau") return ["", "一号戒备信号", "三号强风信号", "八号烈风或暴风信号", "九号烈风或暴风风力增强信号", "十号飓风信号"][severity] || "热带气旋信号";
  if (region === "philippines") return `TCWS #${Math.min(5, severity)}`;
  if (region === "taiwan") return severity >= 2 ? "海上陆上台风警报" : "海上台风警报";
  if (region === "korea") return severity >= 3 ? "台风警报" : "台风注意报";
  if (region === "japan") return severity >= 5 ? "暴风特别警报（模拟）" : severity >= 3 ? "暴风警报（模拟）" : "强风注意报（模拟）";
  if (region === "mainland") return `台风${["", "蓝色", "黄色", "橙色", "红色", "红色"][severity]}预警`;
  return severity >= 4 ? "极端台风警报" : severity >= 3 ? "严重台风警报" : "热带气旋警报";
}


export type WarningBulletin = {
  headline: string;
  issuedAt: string;
  body: string;
  defenseGuide: string[];
  /** Label shown in the UI so each region keeps its own operational product style. */
  styleLabel: string;
  agencyLabel: string;
};

function simDate(startDate: Date | undefined, simHour: number): Date {
  const base = startDate || new Date("2027-06-30T20:00:00");
  return new Date(base.getTime() + simHour * 3600000);
}

function datePartsCN(d: Date): { date: string; hm: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    hm: `${pad(d.getHours())}时${pad(d.getMinutes())}分`
  };
}

function beaufortFromMps(mps: number): number {
  const t = [0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7,37.0,41.5,46.2,51.0,56.1,61.3];
  let level = 0;
  while (level < t.length && mps >= t[level]) level++;
  return Math.min(17, level);
}

function projectedRain(impacts: ForecastImpact[], hours: number): number {
  const rows = impacts.filter((r) => r.leadHour <= hours + 1e-6);
  return rows.reduce((sum, row, i) => {
    const next = rows[i + 1]?.leadHour ?? Math.min(hours, row.leadHour + 3);
    const span = Math.max(0.5, Math.min(3, next - row.leadHour));
    return sum + Math.max(0, row.rainRate) * span;
  }, 0);
}

/**
 * Generate a region-specific *simulated* warning bulletin.  The layout follows the public
 * product conventions of the responsible meteorological service, while all values and wording
 * are generated from TyphoonSIM state.  It is never presented as a real-world live warning.
 */
export function buildOfficialStyleWarningBulletin(
  ty: Typhoon,
  station: PublicAreaStation,
  warning: WarningStatus,
  startDate?: Date,
  transitionVerb = "发布"
): WarningBulletin | null {
  if (warning.severity <= 0) return null;
  const region = getWarningRegion(station.city || station.name, station.lat, station.lon);
  const impacts = buildForecastImpacts(ty, station);
  const horizon = warning.leadHours || 24;
  const rows = impacts.filter((r) => r.leadHour <= horizon + 1e-6);
  const peakWind = rows.reduce((m, r) => Math.max(m, r.wind), 0);
  const peakGust = rows.reduce((m, r) => Math.max(m, r.gust), 0);
  const rain6 = projectedRain(impacts, 6);
  const rain24 = projectedRain(impacts, 24);
  const closest = rows.length ? rows.reduce((a, b) => b.distanceKm < a.distanceKm ? b : a) : impacts[0];
  const d = simDate(startDate, ty.simHour || 0);
  const { date, hm } = datePartsCN(d);
  const area = publicAreaName(station).replace(/全市$/, "");
  const ordinal = getTyphoonOrdinalNumber(ty, startDate);
  const name = String(ty.name || "未命名");
  const currentBft = beaufortFromMps(Number(ty.vmax || 0));
  const peakBft = beaufortFromMps(peakWind);
  const gustBft = beaufortFromMps(peakGust);
  const motion = Number(ty.speed || 0) > 1 ? `每小时${Math.round(Number(ty.speed || 0))}公里` : "移动缓慢";
  const closestText = closest ? `${Math.round(closest.distanceKm)}公里` : "—";
  const issuedAt = region === "philippines"
    ? d.toLocaleString("en-PH", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : region === "japan"
      ? d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : region === "korea"
        ? d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : region === "taiwan"
          ? d.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : region === "hongkong"
            ? d.toLocaleString("zh-HK", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const commonGuide = warning.severity >= 4 ? [
    "立即进入高等级防灾响应，危险区域人员按当地指令转移避险。",
    "停止非必要户外、高空、水上和沿海活动，远离门窗、海堤、河道及山坡。",
    "持续关注最新预警、交通管制、停课停工和避难信息。",
    "强风减弱后仍需防范积涝、山洪、滑坡、倒树和受损设施等滞后风险。"
  ] : [
    "完成门窗、临时设施和户外物品加固，减少非必要外出。",
    "海上、高空、工地及沿海活动提前采取停工避险措施。",
    "关注强降雨、城市积涝、山洪地质灾害及交通调整。"
  ];

  if (region === "mainland") {
    const authority = localMeteorologicalAuthority(station).replace(/^模拟/, "");
    const body = `${authority}${date}${hm}${transitionVerb}${warning.label}：受今年第${ordinal}号台风“${name}”（${ty.category}）影响，当前台风中心位于北纬${Number(ty.lat).toFixed(1)}度、东经${Number(ty.lon).toFixed(1)}度，中心附近最大风力${currentBft}级（${Number(ty.vmax).toFixed(0)}米/秒），中心最低气压${Math.round(Number(ty.pmin || 1000))}百帕，以${motion}左右的速度移动。预计未来${horizon}小时${area}风雨影响增强，预报最近距离约${closestText}；本区平均风最高约${peakBft}级（${peakWind.toFixed(1)}米/秒），阵风最高约${gustBft}级（${peakGust.toFixed(1)}米/秒），未来6小时/24小时累计降水约${rain6.toFixed(0)}/${rain24.toFixed(0)}毫米。请注意防范台风大风、短时强降水及其引发的城市积涝、山洪和地质灾害。`;
    return { headline: `${area}${warning.label}`, issuedAt, body, defenseGuide: commonGuide, styleLabel: "CMA / 地方气象台预警公告样式", agencyLabel: authority };
  }

  if (region === "hongkong") {
    const body = `香港天文台在${date}${hm}${transitionVerb}${warning.label}。\n\n在${hm}，台风“${name}”集结在北纬${Number(ty.lat).toFixed(1)}度、东经${Number(ty.lon).toFixed(1)}度，中心附近最高持续风速约每小时${Math.round(Number(ty.vmax || 0) * 3.6)}公里，正以约${Math.round(Number(ty.speed || 0))}公里每小时移动。按照现时预测路径，热带气旋未来${horizon}小时最接近香港的距离约为${closestText}。\n\n香港普遍风势预计最高约每小时${Math.round(peakWind * 3.6)}公里，阵风可达每小时${Math.round(peakGust * 3.6)}公里；未来6小时雨量约${rain6.toFixed(0)}毫米。市民应留意天文台最新热带气旋消息，并按生效信号采取适当防风措施。`;
    return { headline: `热带气旋警告公告（模拟） · ${warning.label}`, issuedAt, body, defenseGuide: commonGuide, styleLabel: "香港天文台热带气旋警告公告样式", agencyLabel: "香港天文台（模拟）" };
  }

  if (region === "macau") {
    const body = `地球物理气象局于${date}${hm}${transitionVerb}${warning.label}。\n\n热带气旋“${name}”现时位于北纬${Number(ty.lat).toFixed(1)}度、东经${Number(ty.lon).toFixed(1)}度，中心附近最高持续风速约${Math.round(Number(ty.vmax || 0) * 3.6)}公里/小时，以约${Math.round(Number(ty.speed || 0))}公里/小时移动。按现时预测，其未来${horizon}小时与本澳最近距离约${closestText}。\n\n预计本澳风力将达到约${Math.round(peakWind * 3.6)}公里/小时，阵风约${Math.round(peakGust * 3.6)}公里/小时，未来6小时累计雨量约${rain6.toFixed(0)}毫米。低洼地区须同时留意强降雨与风暴增水叠加影响。`;
    return { headline: `热带气旋信号（模拟） · ${warning.label}`, issuedAt, body, defenseGuide: commonGuide, styleLabel: "澳门地球物理气象局热带气旋信号样式", agencyLabel: "地球物理气象局（模拟）" };
  }

  if (region === "taiwan") {
    const r7 = Math.max(0, averageR7(ty));
    const r10 = r7 * 0.55;
    const body = `中央氣象署　颱風警報單（模擬）　${date}${hm}發布\n\n颱風強度及名稱：${ty.category}，${name}。\n中心氣壓：${Math.round(Number(ty.pmin || 1000))}百帕。\n中心位置：北緯${Number(ty.lat).toFixed(1)}度，東經${Number(ty.lon).toFixed(1)}度。\n暴風半徑：7級風暴風半徑約${Math.round(r7)}公里，10級風暴風半徑約${Math.round(r10)}公里。\n預測速度及方向：每小時${Math.round(Number(ty.speed || 0))}公里，持續依模式預報方向移動。\n近中心最大風速：每秒${Number(ty.vmax || 0).toFixed(1)}公尺。\n瞬間最大陣風：每秒${Math.max(Number(ty.vmax || 0) * 1.28, peakGust).toFixed(1)}公尺。\n颱風動態：依最新模擬資料，${name}持續接近影響區域，未來${horizon}小時與${area}最近距離約${closestText}。\n警戒區域及事項：${area}目前為${warning.label}影響範圍，應嚴加戒備強風、豪雨、沿海長浪及低窪積水。`;
    return { headline: `${warning.label}（模擬警報單）`, issuedAt, body, defenseGuide: commonGuide, styleLabel: "中央氣象署颱風警報單樣式", agencyLabel: "中央氣象署（模擬）" };
  }

  if (region === "philippines") {
    const body = `PAGASA TROPICAL CYCLONE BULLETIN (SIMULATED)\nIssued at ${d.toLocaleString("en-PH", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}\n\nTROPICAL CYCLONE “${name.toUpperCase()}”\n\nLocation of Eye/center\nThe center was estimated at ${Number(ty.lat).toFixed(1)}°N, ${Number(ty.lon).toFixed(1)}°E, with a closest simulated approach to ${area} of about ${closestText}.\n\nMovement\nMoving at approximately ${Math.round(Number(ty.speed || 0))} km/h.\n\nStrength\nMaximum sustained winds of ${Math.round(Number(ty.vmax || 0) * 3.6)} km/h near the center and simulated gusts up to ${Math.round(Math.max(Number(ty.vmax || 0) * 1.28, peakGust) * 3.6)} km/h.\n\nWind Signal\n${area}: ${warning.label}. Peak local sustained wind within the warning horizon is about ${Math.round(peakWind * 3.6)} km/h.\n\nHAZARDS AFFECTING LAND AREAS\nHeavy rainfall, severe winds, flooding and landslide impacts remain possible in exposed or highly susceptible areas.`;
    return { headline: `Tropical Cyclone Bulletin · ${warning.label} (SIMULATED)`, issuedAt, body, defenseGuide: ["Follow evacuation and other instructions from local disaster risk reduction offices.", "Secure light structures and avoid coastal waters, floodways and landslide-prone slopes.", "Monitor subsequent simulated bulletins for changes in wind signal and rainfall outlook."], styleLabel: "PAGASA Tropical Cyclone Bulletin (SIMULATED)", agencyLabel: "PAGASA (SIMULATED)" };
  }

  if (region === "japan") {
    const body = `気象警報・注意報（シミュレーション）\n${date}${hm} 発表\n\n対象地域：${area}\n発表状況：${warning.label}\n\n台風「${name}」は北緯${Number(ty.lat).toFixed(1)}度、東経${Number(ty.lon).toFixed(1)}度付近にあり、中心気圧${Math.round(Number(ty.pmin || 1000))}hPa、最大風速${Number(ty.vmax || 0).toFixed(1)}m/s。今後${horizon}時間以内の最接近距離は約${closestText}。${area}では最大風速約${peakWind.toFixed(1)}m/s、最大瞬間風速約${peakGust.toFixed(1)}m/s、6時間雨量約${rain6.toFixed(0)}mmを見込む。\n\n暴風、低い土地の浸水、河川の増水、土砂災害、高波・高潮に警戒してください。`;
    return { headline: `${area} 気象警報・注意報（シミュレーション）`, issuedAt, body, defenseGuide: ["不要不急の外出を控え、自治体の避難情報を確認してください。", "海岸・河川・崖やアンダーパスなど危険な場所に近づかないでください。", "交通機関の運休・欠航、停電などに備えてください。"], styleLabel: "気象庁 気象警報・注意報（シミュレーション）", agencyLabel: "気象庁（シミュレーション）" };
  }

  if (region === "korea") {
    const body = `[태풍특보 / 모의]\n발표시각: ${date}${hm}\n대상지역: ${area}\n특보종류: ${warning.label}\n\n태풍 '${name}'은 북위 ${Number(ty.lat).toFixed(1)}도, 동경 ${Number(ty.lon).toFixed(1)}도 부근에 위치하며 중심기압은 ${Math.round(Number(ty.pmin || 1000))}hPa, 중심 부근 최대풍속은 ${Number(ty.vmax || 0).toFixed(1)}m/s입니다. 향후 ${horizon}시간 동안 ${area} 최근접 거리는 약 ${closestText}이며, 최대 평균풍속 ${peakWind.toFixed(1)}m/s, 최대순간풍속 ${peakGust.toFixed(1)}m/s, 6시간 강수량 약 ${rain6.toFixed(0)}mm가 예상됩니다.\n\n강풍·호우·해안 저지대 침수와 산사태 등 안전사고에 각별히 유의하기 바랍니다.`;
    return { headline: `${area} ${warning.label} (모의)`, issuedAt, body, defenseGuide: ["야외 활동과 해안·산간 출입을 줄이고 재난문자와 지자체 안내를 확인하십시오.", "간판·비닐하우스·공사장 시설물을 고정하고 침수 위험 지하공간을 점검하십시오.", "교통 통제와 항공·선박 운항 변경에 대비하십시오."], styleLabel: "기상청 기상특보 (모의)", agencyLabel: "기상청 (모의)" };
  }

  const body = `${date}${hm} ${area}${transitionVerb}${warning.label}。台风“${name}”未来${horizon}小时可能给本地带来强风和强降雨，最近距离约${closestText}，局地最大风约${peakWind.toFixed(1)}m/s，未来6小时雨量约${rain6.toFixed(0)}mm。`;
  return { headline: `${area}${warning.label}（模拟）`, issuedAt, body, defenseGuide: commonGuide, styleLabel: "区域气象警报样式", agencyLabel: warning.authority };
}

/** Backward-compatible entry retained for existing code/tests. */
export function buildNmcStyleWarningBulletin(
  ty: Typhoon,
  station: PublicAreaStation,
  warning: WarningStatus,
  startDate?: Date,
  transitionVerb = "发布"
): WarningBulletin | null {
  if (getWarningRegion(station.city || station.name, station.lat, station.lon) !== "mainland") return null;
  return buildOfficialStyleWarningBulletin(ty, station, warning, startDate, transitionVerb);
}

function buildHistoricalWarningBody(
  region: WarningRegion,
  area: string,
  ty: Typhoon,
  warningLabel: string,
  previousLabel: string,
  verb: string,
  d: { date: string; hm: string },
  wind: number,
  rain6: number,
  authority: string
): string {
  const ordinal = normalizeTyphoonSequenceNumber(ty.officialNumber, Number(ty.seasonOrdinal || 1));
  if (verb === "解除") {
    if (region === "hongkong") return `香港天文台在${d.date}${d.hm}取消所有热带气旋警告信号。虽然风势正在缓和，与台风“${ty.name}”相关的骤雨、涌浪及低洼水浸风险仍可能持续。`;
    if (region === "macau") return `地球物理气象局于${d.date}${d.hm}取消所有热带气旋信号。受残余雨带影响，本澳仍需留意骤雨、强阵风及低洼地区水浸。`;
    if (region === "philippines") return `PAGASA TROPICAL CYCLONE BULLETIN (SIMULATED): Tropical Cyclone Wind Signal for ${area} has been lifted. Residual heavy rainfall and flooding hazards may still persist.`;
    if (region === "taiwan") return `中央氣象署於${d.date}${d.hm}解除${previousLabel}（模擬）。${area}仍應注意颱風外圍環流帶來的強陣風、豪雨及沿海長浪。`;
    if (region === "japan") return `気象庁（シミュレーション） ${d.date}${d.hm}：${area}の${previousLabel}を解除。大雨・河川増水・土砂災害などの遅れて現れる危険に引き続き注意。`;
    if (region === "korea") return `기상청 모의 특보 ${d.date}${d.hm}: ${area}의 ${previousLabel} 해제. 강풍이 약화된 뒤에도 호우·침수·산사태 위험에 유의 바랍니다.`;
    return `${authority}${d.date}${d.hm}解除${previousLabel}：影响${area}的台风风雨已明显减弱，但低洼积水、河网高水位、地质灾害等滞后风险仍可能持续。`;
  }
  if (region === "hongkong") return `香港天文台在${d.date}${d.hm}${verb}${warningLabel}。台风“${ty.name}”继续影响香港，模拟区内持续风约每小时${Math.round(wind * 3.6)}公里，骤雨仍会间中较大。`;
  if (region === "macau") return `地球物理气象局于${d.date}${d.hm}${verb}${warningLabel}。台风“${ty.name}”继续影响本澳，模拟持续风约${Math.round(wind * 3.6)}公里/小时，近6小时雨量约${rain6.toFixed(0)}毫米。`;
  if (region === "taiwan") return `中央氣象署　颱風警報單（模擬）　${d.date}${d.hm}發布：第${ordinal}號颱風「${ty.name}」持續影響${area}，目前${verb}${warningLabel}；近6小時雨量約${rain6.toFixed(0)}毫米，請嚴加戒備強風豪雨。`;
  if (region === "philippines") return `PAGASA TROPICAL CYCLONE BULLETIN (SIMULATED): ${area} is now under ${warningLabel}. Severe winds of about ${Math.round(wind * 3.6)} km/h and heavy rainfall remain possible. Disaster preparedness agencies are advised to take necessary measures.`;
  if (region === "japan") return `気象庁（シミュレーション） ${d.date}${d.hm}：${area}に${warningLabel}を${verb}。台風「${ty.name}」の影響で最大風速約${wind.toFixed(1)}m/s、6時間雨量約${rain6.toFixed(0)}mm。暴風・浸水・土砂災害に警戒。`;
  if (region === "korea") return `기상청 모의 특보 ${d.date}${d.hm}: ${area} ${warningLabel} ${verb}. 태풍 '${ty.name}' 영향으로 평균풍속 약 ${wind.toFixed(1)}m/s, 최근 6시간 강수량 약 ${rain6.toFixed(0)}mm. 안전사고에 유의 바랍니다.`;
  return `${authority}${d.date}${d.hm}${verb}${warningLabel}：受今年第${ordinal}号台风“${ty.name}”影响，${area}代表性区域平均风约${beaufortFromMps(wind)}级（${wind.toFixed(1)}米/秒），近6小时降水约${rain6.toFixed(0)}毫米。`;
}

export function buildEmergencyNews(
  ty: Typhoon,
  station: PublicAreaStation,
  history: StationHistoryDatum[],
  currentWarning: WarningStatus,
  airport: ReturnType<typeof getAirportStatus>,
  startDate?: Date
): EmergencyNewsItem[] {
  const city = publicAreaCity(station);
  const area = publicAreaName(station).replace(/全市$/, "");
  const areaSeed = publicAreaSeed(station);
  const region = getWarningRegion(station.city || station.name, station.lat, station.lon);
  const profile = getDistrictRiskProfile(station);
  const items: EmergencyNewsItem[] = [];
  const rows = [...history].sort((a, b) => a.time - b.time);
  let prevWarning = 0;
  const lastHazardHour: Record<string, number> = {};
  const canPost = (key: string, hour: number, cooldown = 6) => hour - (lastHazardHour[key] ?? -999) >= cooldown;
  const push = (item: EmergencyNewsItem, key?: string) => {
    items.push(item);
    if (key) lastHazardHour[key] = item.simHour;
  };
  const prob = (hour: number, key: string, p: number) => deterministic01(`${ty.id}:${areaSeed}:${hour}:${key}`) < Math.max(0, Math.min(0.97, p));
  const pick = (group: keyof typeof EVENT_LIBRARY, hour: number) => eventPick(group, `${areaSeed}:${hour}:${group}`);
  const rainWindow = (at: number, hours: number) => rows
    .filter((r) => r.time > at - hours - 1e-6 && r.time <= at + 1e-6)
    .reduce((sum, r) => sum + Math.max(0, Number(r.precipitation || 0)), 0);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i > 0 && row.time - rows[i - 1].time < 0.8) continue;
    const rain3 = rainWindow(row.time, 3);
    const rain6 = rainWindow(row.time, 6);
    const rain24 = rainWindow(row.time, 24);
    let warning = simpleSeverityFromWind(row.wind);
    if (rain6 >= 180 || rain24 >= 300) warning = Math.max(warning, 4);
    else if (rain6 >= 120 || rain24 >= 220) warning = Math.max(warning, 3);
    else if (rain6 >= 70 || rain24 >= 140) warning = Math.max(warning, 2);

    if (warning !== prevWarning) {
      const verb = prevWarning === 0 && warning > 0 ? "发布" : warning === 0 ? "解除" : warning > prevWarning ? "升级为" : "调整为";
      const oldLabel = historicalWarningName(region, prevWarning);
      const newLabel = historicalWarningName(region, warning);
      const d = datePartsCN(simDate(startDate, row.time));
      const authority = region === "mainland" ? `${area.replace(/全市$/, "")}气象台` : currentWarning.authority.replace(/^模拟/, "");
      const body = buildHistoricalWarningBody(region, area, ty, newLabel, oldLabel, verb, d, row.wind, rain6, authority);
      push({ id: `warning-${areaSeed}-${row.time}-${warning}`, simHour: row.time, type: "warning", severity: warning, title: warning > 0 ? `${area}：${verb}${newLabel}` : `${area}：解除${oldLabel}`, body }, "warning-change");
      prevWarning = warning;
    }

    const floodRisk = Math.max(row.precipitation / 45, rain3 / 100, rain6 / 170) * (0.72 + 0.55 * profile.lowland);
    if ((row.precipitation >= 22 || rain3 >= 65 || rain6 >= 90) && canPost("flood", row.time, 5) && prob(row.time, "flood", 0.18 + floodRisk * 0.35)) {
      push({ id: `flood-${areaSeed}-${row.time}`, simHour: row.time, type: "hazard", severity: floodRisk >= 1.25 ? 4 : 3, title: `${area} · 内涝热点`, body: pick("flood", row.time) }, "flood");
    }
    if (profile.urban >= 0.58 && (rain3 >= 75 || rain6 >= 110) && canPost("metro", row.time, 8) && prob(row.time, "metro", 0.08 + profile.urban * 0.26 + rain6 / 900)) {
      push({ id: `metro-${areaSeed}-${row.time}`, simHour: row.time, type: "traffic", severity: rain6 >= 160 ? 4 : 3, title: `${area} · 公共交通热点`, body: pick("metro", row.time) }, "metro");
    }
    if (row.stormSurge >= 0.65 && profile.coastal >= 0.42 && canPost("surge", row.time, 8) && prob(row.time, "surge", 0.18 + row.stormSurge / 3.4 + profile.coastal * 0.18)) {
      push({ id: `surge-${areaSeed}-${row.time}`, simHour: row.time, type: "hazard", severity: row.stormSurge >= 1.55 ? 4 : 3, title: `${area} · 风暴潮动态`, body: pick("surge", row.time) }, "surge");
    }
    if (rain6 >= 95 && profile.mountain >= 0.42 && canPost("landslide", row.time, 9) && prob(row.time, "slide", 0.05 + profile.mountain * 0.28 + rain6 / 700)) {
      push({ id: `slide-${areaSeed}-${row.time}`, simHour: row.time, type: "hazard", severity: rain6 >= 175 ? 4 : 3, title: `${area} · 山洪地质灾害`, body: pick("landslide", row.time) }, "landslide");
    }
    if (rain6 >= 95 && profile.river >= 0.45 && canPost("river", row.time, 9) && prob(row.time, "river", 0.08 + profile.river * 0.24 + rain6 / 900)) {
      push({ id: `river-${areaSeed}-${row.time}`, simHour: row.time, type: "hazard", severity: rain24 >= 220 ? 4 : 3, title: `${area} · 河网水情`, body: pick("river", row.time) }, "river");
    }
    if (rain24 >= 230 && profile.river >= 0.35 && canPost("dam", row.time, 18) && prob(row.time, "dam", 0.008 + Math.max(0, rain24 - 220) / 2200 + profile.mountain * 0.025)) {
      push({ id: `dam-${areaSeed}-${row.time}`, simHour: row.time, type: "hazard", severity: 5, title: `${area} · 水库/坝体险情热点`, body: pick("dam", row.time) }, "dam");
    }
    if (row.wind >= 18 && canPost("wind", row.time, 6) && prob(row.time, "wind", 0.12 + row.wind / 85)) {
      push({ id: `wind-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: row.wind >= 32.7 ? 4 : 3, title: `${area} · 强风影响`, body: pick("wind", row.time) }, "wind");
    }
    if (row.wind >= 17 && canPost("power", row.time, 9) && prob(row.time, "power", 0.05 + row.wind / 110 + profile.density * 0.08)) {
      push({ id: `power-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: row.wind >= 30 ? 4 : 2, title: `${area} · 电力保障`, body: pick("power", row.time) }, "power");
    }
    if (row.wind >= 16 && canPost("construction", row.time, 10) && prob(row.time, "construction", 0.12 + profile.urban * 0.22 + row.wind / 150)) {
      push({ id: `construction-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: row.wind >= 28 ? 4 : 2, title: `${area} · 建筑工地风险`, body: pick("construction", row.time) }, "construction");
    }
    if (warning >= 2 && canPost("school", row.time, 12) && prob(row.time, "school", 0.15 + warning * 0.12 + profile.density * 0.10)) {
      push({ id: `school-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: warning, title: `${area} · 教育与停课动态`, body: pick("school", row.time) }, "school");
    }
    if ((warning >= 3 || rain6 >= 135 || row.stormSurge >= 1.15) && canPost("evacuation", row.time, 12) && prob(row.time, "evacuation", 0.09 + warning * 0.10 + rain6 / 1300)) {
      push({ id: `evac-${areaSeed}-${row.time}`, simHour: row.time, type: "response", severity: Math.max(3, warning), title: `${area} · 人员转移`, body: pick("evacuation", row.time) }, "evacuation");
    }
    if ((warning >= 2 || rain6 >= 100) && canPost("response", row.time, 9) && prob(row.time, "response", 0.26 + warning * 0.07)) {
      push({ id: `response-${areaSeed}-${row.time}`, simHour: row.time, type: "response", severity: Math.max(1, warning), title: `${area} · 防灾响应进展`, body: pick("response", row.time) }, "response");
    }
    if ((rain6 >= 115 || warning >= 3) && canPost("medical", row.time, 14) && prob(row.time, "medical", 0.10 + profile.density * 0.16 + warning * 0.05)) {
      push({ id: `medical-${areaSeed}-${row.time}`, simHour: row.time, type: "response", severity: Math.max(2, warning), title: `${area} · 医疗救援保障`, body: pick("medical", row.time) }, "medical");
    }
    if (row.wind >= 24 && canPost("telecom", row.time, 12) && prob(row.time, "telecom", 0.06 + row.wind / 150)) {
      push({ id: `telecom-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: row.wind >= 33 ? 4 : 2, title: `${area} · 通信保障`, body: pick("telecom", row.time) }, "telecom");
    }
    if (warning >= 2 && canPost("supply", row.time, 18) && prob(row.time, "supply", 0.12 + profile.density * 0.14 + warning * 0.05)) {
      push({ id: `supply-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: warning >= 4 ? 3 : 2, title: `${area} · 生活物资保供`, body: pick("supply", row.time) }, "supply");
    }
    if ((rain3 >= 55 || rain6 >= 95) && canPost("drainage", row.time, 6) && prob(row.time, "drainage", 0.18 + profile.urban * 0.20 + profile.lowland * 0.22 + rain6 / 1000)) {
      push({ id: `drainage-${areaSeed}-${row.time}`, simHour: row.time, type: "response", severity: rain6 >= 150 ? 4 : 2, title: `${area} · 排水调度`, body: pick("drainage", row.time) }, "drainage");
    }
    if (profile.urban >= 0.50 && (rain3 >= 70 || rain6 >= 115) && canPost("tunnel", row.time, 10) && prob(row.time, "tunnel", 0.08 + profile.lowland * 0.24 + rain6 / 1200)) {
      push({ id: `tunnel-${areaSeed}-${row.time}`, simHour: row.time, type: "traffic", severity: rain6 >= 170 ? 4 : 3, title: `${area} · 下穿隧道与地下通道`, body: pick("tunnel", row.time) }, "tunnel");
    }
    if (row.wind >= 19 && canPost("bridge", row.time, 9) && prob(row.time, "bridge", 0.08 + row.wind / 120 + profile.coastal * 0.10)) {
      push({ id: `bridge-${areaSeed}-${row.time}`, simHour: row.time, type: "traffic", severity: row.wind >= 29 ? 4 : 2, title: `${area} · 桥梁侧风管控`, body: pick("bridge", row.time) }, "bridge");
    }
    if (profile.coastal >= 0.45 && (row.wind >= 17 || row.stormSurge >= 0.55) && canPost("port", row.time, 10) && prob(row.time, "port", 0.10 + profile.coastal * 0.22 + row.wind / 150 + row.stormSurge / 8)) {
      push({ id: `port-${areaSeed}-${row.time}`, simHour: row.time, type: "traffic", severity: row.wind >= 28 || row.stormSurge >= 1.3 ? 4 : 2, title: `${area} · 港口与水运`, body: pick("port", row.time) }, "port");
    }
    if ((rain6 >= 120 || warning >= 3) && canPost("waterSupply", row.time, 14) && prob(row.time, "waterSupply", 0.05 + rain6 / 1400 + profile.density * 0.10)) {
      push({ id: `water-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: rain6 >= 190 ? 3 : 2, title: `${area} · 供水保障`, body: pick("waterSupply", row.time) }, "waterSupply");
    }
    if ((row.wind >= 24 || rain6 >= 145) && canPost("gas", row.time, 16) && prob(row.time, "gas", 0.04 + row.wind / 190 + rain6 / 2000)) {
      push({ id: `gas-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: 2, title: `${area} · 燃气设施巡查`, body: pick("gas", row.time) }, "gas");
    }
    if (profile.density >= 0.56 && (row.wind >= 21 || rain6 >= 120) && canPost("elevator", row.time, 14) && prob(row.time, "elevator", 0.05 + profile.density * 0.14 + row.wind / 210)) {
      push({ id: `elevator-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: 2, title: `${area} · 高层住宅与电梯`, body: pick("elevator", row.time) }, "elevator");
    }
    if ((rain6 >= 100 || warning >= 3) && canPost("sanitation", row.time, 16) && prob(row.time, "sanitation", 0.08 + rain6 / 1600 + warning * 0.03)) {
      push({ id: `sanitation-${areaSeed}-${row.time}`, simHour: row.time, type: "response", severity: 2, title: `${area} · 环卫与灾后清障`, body: pick("sanitation", row.time) }, "sanitation");
    }
    if (row.wind >= 20 && canPost("trees", row.time, 8) && prob(row.time, "trees", 0.10 + row.wind / 105)) {
      push({ id: `trees-${areaSeed}-${row.time}`, simHour: row.time, type: "hazard", severity: row.wind >= 30 ? 4 : 2, title: `${area} · 倒树与高空坠物`, body: pick("trees", row.time) }, "trees");
    }
    if ((warning >= 3 || rain6 >= 145 || row.stormSurge >= 1.15) && canPost("shelters", row.time, 14) && prob(row.time, "shelters", 0.12 + warning * 0.08 + rain6 / 1800)) {
      push({ id: `shelter-${areaSeed}-${row.time}`, simHour: row.time, type: "response", severity: Math.max(2, warning), title: `${area} · 避难场所`, body: pick("shelters", row.time) }, "shelters");
    }
    if ((row.wind >= 18 || rain24 >= 150) && canPost("agriculture", row.time, 18) && prob(row.time, "agriculture", 0.08 + row.wind / 160 + rain24 / 2400)) {
      push({ id: `agriculture-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: row.wind >= 28 || rain24 >= 240 ? 3 : 2, title: `${area} · 农业与养殖`, body: pick("agriculture", row.time) }, "agriculture");
    }
    if (warning >= 2 && canPost("logistics", row.time, 16) && prob(row.time, "logistics", 0.08 + warning * 0.06 + profile.density * 0.08)) {
      push({ id: `logistics-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: warning >= 4 ? 3 : 2, title: `${area} · 物流与保供运输`, body: pick("logistics", row.time) }, "logistics");
    }
    if ((row.wind >= 23 || rain6 >= 135) && canPost("fireRescue", row.time, 10) && prob(row.time, "fireRescue", 0.10 + row.wind / 150 + rain6 / 1600)) {
      push({ id: `rescue-${areaSeed}-${row.time}`, simHour: row.time, type: "response", severity: row.wind >= 32 || rain6 >= 190 ? 4 : 2, title: `${area} · 消防救援动态`, body: pick("fireRescue", row.time) }, "fireRescue");
    }
    if (profile.river >= 0.38 && rain24 >= 170 && canPost("reservoir", row.time, 16) && prob(row.time, "reservoir", 0.06 + profile.river * 0.16 + rain24 / 2200)) {
      push({ id: `reservoir-${areaSeed}-${row.time}`, simHour: row.time, type: "hazard", severity: rain24 >= 260 ? 4 : 2, title: `${area} · 水库山塘调度`, body: pick("reservoir", row.time) }, "reservoir");
    }
    if (profile.coastal >= 0.45 && (row.stormSurge >= 0.7 || row.wind >= 22) && canPost("coastalClosure", row.time, 9) && prob(row.time, "coastalClosure", 0.12 + profile.coastal * 0.18 + row.stormSurge / 7)) {
      push({ id: `coastal-${areaSeed}-${row.time}`, simHour: row.time, type: "traffic", severity: row.stormSurge >= 1.4 || row.wind >= 30 ? 4 : 3, title: `${area} · 滨海区域封控`, body: pick("coastalClosure", row.time) }, "coastalClosure");
    }
    if (warning >= 3 && canPost("shutdown", row.time, 12) && prob(row.time, "shutdown", 0.16 + warning * 0.12)) {
      push({ id: `shutdown-${areaSeed}-${row.time}`, simHour: row.time, type: "information", severity: warning, title: `${area} · 停课停工与公共服务调整`, body: pick("shutdown", row.time) }, "shutdown");
    }
  }

  const currentHour = rows[rows.length - 1]?.time ?? ty.simHour;
  // Landfall is a high-priority factual event in the simulated timeline.  Publish it to districts
  // that are already under a cyclone warning or lie within a broad impact radius of the crossing.
  for (const lf of (ty.landfallRecords || [])) {
    if (lf.simHour > currentHour + 1e-6) continue;
    const dKm = distanceKm(station.lat, station.lon, lf.lat, lf.lon);
    if (currentWarning.severity <= 0 && dKm > Math.max(320, averageR7(ty) * 1.35)) continue;
    const landName = String(lf.region || "沿海地区").replace(/\s+/g, " ").trim();
    push({
      id: `landfall-${areaSeed}-${lf.simHour.toFixed(2)}-${lf.lat.toFixed(2)}-${lf.lon.toFixed(2)}`,
      simHour: lf.simHour,
      type: "information",
      severity: lf.vmax >= 41.5 ? 5 : lf.vmax >= 32.7 ? 4 : 3,
      title: `${area} · 台风登陆`,
      body: `台风“${ty.name}”于模拟时刻在${landName}附近登陆，登陆点约为北纬${lf.lat.toFixed(2)}度、东经${lf.lon.toFixed(2)}度，登陆时中心附近最大风速约${lf.vmax.toFixed(1)}米/秒。登陆后强风会逐步减弱，但强降水、内涝、山洪、风暴潮和交通中断等风险可能继续向内陆延伸。`
    });
  }
  if (airport.level >= 2) push({ id: `airport-current-${areaSeed}-${airport.level}`, simHour: currentHour, type: "traffic", severity: airport.level, title: `${area} · ${airport.airport}`, body: `${airport.status}。${airport.detail}` });
  if (currentWarning.severity >= 1) push({ id: `current-warning-${areaSeed}-${currentWarning.id}`, simHour: currentHour + 0.001, type: "warning", severity: currentWarning.severity, title: `${area}当前：${currentWarning.label}`, body: `${currentWarning.reason} ${currentWarning.action}` });
  if (currentWarning.severity >= 2 || (rows[rows.length - 1]?.precipitation || 0) >= 18) push({ id: `guidance-current-${areaSeed}`, simHour: currentHour + 0.002, type: "guidance", severity: Math.max(2, currentWarning.severity), title: `${area} · 公众安全提示`, body: pick("guidance", currentHour) });

  // No hard item cap: cooldowns and probability gates control density while preserving the full
  // event history requested by the user. Same areaKey => the same deterministic district feed.
  return items.sort((a, b) => b.simHour - a.simHour);
}

export function formatEmergencyTime(startDate: Date | undefined, simHour: number): string {
  const base = startDate || new Date("2027-06-30T20:00:00");
  const d = new Date(base.getTime() + simHour * 3600000);
  return d.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
