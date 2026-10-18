import {
  buildDistrictPublicHistory,
  buildDistrictRepresentativeReading,
  buildEmergencyNews,
  buildForecastImpacts,
  buildNmcStyleWarningBulletin,
  buildOfficialStyleWarningBulletin,
  buildPrimaryWarning,
  getAirportStatus,
  type PublicAreaStation
} from "../src/utils/CityEmergencyModel";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const typhoon: any = {
  id: "district-regression",
  name: "测试台风",
  seasonOrdinal: 8,
  category: "台风",
  lat: 30.55,
  lon: 122.15,
  vmax: 44,
  pmin: 950,
  rmw: 34,
  speed: 18,
  simHour: 12,
  r7: { ne: 220, se: 200, sw: 180, nw: 210 },
  forecastPath: [
    { simHour: 3, lat: 30.75, lon: 121.95, vmax: 44, pmin: 950 },
    { simHour: 6, lat: 30.95, lon: 121.72, vmax: 42, pmin: 955 },
    { simHour: 9, lat: 31.08, lon: 121.52, vmax: 39, pmin: 960 },
    { simHour: 12, lat: 31.25, lon: 121.35, vmax: 35, pmin: 966 },
    { simHour: 18, lat: 31.65, lon: 121.05, vmax: 29, pmin: 974 },
    { simHour: 24, lat: 32.10, lon: 120.75, vmax: 23, pmin: 982 }
  ],
  landfallRecords: [{ lat: 30.95, lon: 121.70, vmax: 40, simHour: 9, region: "上海市沿海" }],
  history: Array.from({ length: 13 }, (_, h) => ({
    simHour: h,
    lat: 29.7 + h * 0.07,
    lon: 122.8 - h * 0.055,
    vmax: 32 + Math.min(h, 8) * 1.5,
    pmin: 980 - Math.min(h, 8) * 3,
    rmw: 38 - Math.min(h, 8) * 0.4,
    r7: { ne: 210, se: 190, sw: 175, nw: 200 }
  }))
};

// These represent two different double-click points inside Changning District.
// Exact point forecast values should be free to differ.
const clickA = { name: "上海", lat: 31.205, lon: 121.395 };
const clickB = { name: "上海", lat: 31.235, lon: 121.455 };
const pointA = buildForecastImpacts(typhoon, clickA);
const pointB = buildForecastImpacts(typhoon, clickB);
assert(pointA[0].distanceKm !== pointB[0].distanceKm, "exact click-point meteorology should remain coordinate-specific");

// Public state is anchored to one district representative point / areaKey.
const district: PublicAreaStation = {
  name: "上海市长宁区",
  city: "上海",
  district: "长宁区",
  areaKey: "中国|上海市|上海市|长宁区",
  areaDisplayName: "上海市长宁区",
  lat: 31.218,
  lon: 121.410
};
const sameDistrictFromAnotherClick: PublicAreaStation = { ...district };

const hist1 = buildDistrictPublicHistory(typhoon, district);
const hist2 = buildDistrictPublicHistory(typhoon, sameDistrictFromAnotherClick);
assert(JSON.stringify(hist1) === JSON.stringify(hist2), "same district must share public history");

const reading1 = buildDistrictRepresentativeReading(typhoon, district, hist1);
const reading2 = buildDistrictRepresentativeReading(typhoon, sameDistrictFromAnotherClick, hist2);
const warn1 = buildPrimaryWarning(typhoon, district, reading1);
const warn2 = buildPrimaryWarning(typhoon, sameDistrictFromAnotherClick, reading2);
assert(JSON.stringify(warn1) === JSON.stringify(warn2), "same district must share warning state");
assert(warn1.authority.includes("上海市长宁区气象台"), "warning authority should be district meteorological station");

const publicImpacts = buildForecastImpacts(typhoon, district, reading1);
const airport1 = getAirportStatus("上海", publicImpacts, reading1, "长宁区");
const airport2 = getAirportStatus("上海", publicImpacts, reading2, "长宁区");
assert(JSON.stringify(airport1) === JSON.stringify(airport2), "same district must share airport status");
assert(airport1.airport.includes("虹桥"), "Changning District should associate with Hongqiao airport");

const news1 = buildEmergencyNews(typhoon, district, hist1, warn1, airport1, new Date("2026-08-08T00:00:00+08:00"));
const news2 = buildEmergencyNews(typhoon, sameDistrictFromAnotherClick, hist2, warn2, airport2, new Date("2026-08-08T00:00:00+08:00"));
assert(JSON.stringify(news1) === JSON.stringify(news2), "same district must share deterministic emergency feed");
assert(news1.length > 16, "district feed should no longer be truncated at 16 items");
assert(news1.some((item) => item.title.includes("台风登陆")), "landfall should appear in district news feed");

// The district fixture can legitimately diagnose severity 0 at this exact synthetic point.
// Bulletin-format regression needs an active warning, so elevate only the fixture warning state
// instead of changing production warning thresholds.
const bulletinWarning = warn1.severity > 0 ? warn1 : { ...warn1, severity: 4, label: "台风红色预警", leadHours: warn1.leadHours || 24 };
const bulletin = buildNmcStyleWarningBulletin(typhoon, district, bulletinWarning, new Date("2026-08-08T00:00:00+08:00"));
assert(bulletin, "mainland active warning should produce simulated NMC/CMA-style bulletin");
assert(bulletin!.body.includes("上海市长宁区气象台"), "bulletin should identify district issuer");
assert(bulletin!.body.includes("受今年第8号台风"), "bulletin should include typhoon ordinal/name context");
assert(bulletin!.defenseGuide.length >= 4, "bulletin should include defense guide");


const regionalBulletinCases: Array<[string, PublicAreaStation]> = [
  ["香港天文台", { name: "香港", city: "香港", district: "香港", areaKey: "hk", areaDisplayName: "香港", lat: 22.30, lon: 114.17 }],
  ["澳门", { name: "澳门", city: "澳门", district: "澳门", areaKey: "mo", areaDisplayName: "澳门", lat: 22.19, lon: 113.54 }],
  ["中央氣象署", { name: "台北", city: "台北", district: "台北", areaKey: "tw", areaDisplayName: "台北市", lat: 25.04, lon: 121.56 }],
  ["PAGASA", { name: "马尼拉", city: "马尼拉", district: "马尼拉", areaKey: "ph", areaDisplayName: "Manila", lat: 14.60, lon: 120.98 }],
  ["JMA", { name: "东京", city: "东京", district: "东京", areaKey: "jp", areaDisplayName: "東京都", lat: 35.68, lon: 139.76 }],
  ["KMA", { name: "首尔", city: "首尔", district: "首尔", areaKey: "kr", areaDisplayName: "서울", lat: 37.57, lon: 126.98 }]
];
for (const [label, st] of regionalBulletinCases) {
  const fakeWarning: any = { id: `test-${label}`, severity: 3, label: "台风警报", authority: `模拟${label}`, reason: "test", action: "test", leadHours: 24, sourceNote: "test" };
  const b = buildOfficialStyleWarningBulletin({ ...typhoon, lat: st.lat + 1, lon: st.lon + 1 } as any, st, fakeWarning, new Date("2026-08-08T00:00:00+08:00"));
  assert(b && b.styleLabel.length > 0, `${label} should have a regional official-style bulletin`);
}

console.log("district_public_state_regression: PASS");
console.log(`warning=${warn1.label}; airport=${airport1.airport}; feed=${news1.length}`);
