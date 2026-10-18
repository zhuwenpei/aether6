import { stationCityDisplayName, stationCityName } from "../src/utils/CityNames";

const cases: Array<{ raw: string; lat: number; lon: number; city: string; display: string }> = [
  { raw: "长宁区", lat: 31.2204, lon: 121.4246, city: "上海", display: "上海市" },
  { raw: "上海市长宁区", lat: 31.2204, lon: 121.4246, city: "上海", display: "上海市" },
  { raw: "南山区", lat: 22.5333, lon: 113.9304, city: "深圳", display: "深圳市" },
  { raw: "天河区", lat: 23.1356, lon: 113.3612, city: "广州", display: "广州市" },
  { raw: "香洲区", lat: 22.2730, lon: 113.5430, city: "珠海", display: "珠海市" },
  { raw: "惠城区", lat: 23.1110, lon: 114.4160, city: "惠州", display: "惠州市" },
  { raw: "东京", lat: 35.6895, lon: 139.6917, city: "东京", display: "东京" },
  { raw: "香港", lat: 22.3193, lon: 114.1694, city: "香港", display: "香港" },
];

for (const item of cases) {
  const city = stationCityName(item.raw, item.lat, item.lon);
  const display = stationCityDisplayName(item.raw, item.lat, item.lon);
  if (city !== item.city || display !== item.display) {
    throw new Error(`${item.raw}: expected ${item.city}/${item.display}, got ${city}/${display}`);
  }
}

console.log("City station-name regression passed.");
console.table(cases.map((item) => ({ raw: item.raw, result: stationCityDisplayName(item.raw, item.lat, item.lon) })));
