import { useEffect, useMemo, useState } from "react";
import {
  X, AlertTriangle, Plane, ShieldCheck, Waves, CloudRain, Wind, Gauge, Eye,
  Thermometer, Droplets, MapPin, Radio, Activity, School, Siren, Construction, Info, Image as ImageIcon,
  ArrowLeft, Download, FileText
} from "lucide-react";
import type { StationReading, Typhoon } from "../types";
import type { StationAdministrativeArea } from "../simulation/Engine";
import { TYPHOON_NAMING_TABLE } from "../data/typhoonNamingTable";
import { stationCityName, stationCityDisplayName } from "../utils/CityNames";
import {
  buildCurrentWarnings,
  buildDistrictPublicHistory,
  buildDistrictRepresentativeReading,
  buildEmergencyNews,
  buildForecastImpacts,
  buildOfficialStyleWarningBulletin,
  buildPrimaryWarning,
  estimateWaterloggingDepthCm,
  formatEmergencyTime,
  getAirportStatus,
  getInfrastructureProfile,
  getPreparednessProgress,
  getWarningRegion,
  recentRain,
  type WarningRegion,
  type EmergencyNewsItem,
  type StationHistoryDatum
} from "../utils/CityEmergencyModel";

interface Props {
  station: { id: string; name: string; lat: number; lon: number; temporary?: boolean };
  typhoon: Typhoon;
  reading?: StationReading;
  historyData: StationHistoryDatum[];
  startDate?: Date;
  adminArea?: StationAdministrativeArea;
  onClose: () => void;
}

const warningRegionLabel: Record<string, string> = {
  mainland: "中国大陆", hongkong: "香港", macau: "澳门", taiwan: "台湾", philippines: "菲律宾", japan: "日本", korea: "韩国", generic: "通用"
};

function severityClass(level: number) {
  if (level >= 5) return "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200";
  if (level >= 4) return "border-red-500/40 bg-red-500/10 text-red-200";
  if (level >= 3) return "border-orange-500/40 bg-orange-500/10 text-orange-200";
  if (level >= 2) return "border-yellow-500/40 bg-yellow-500/10 text-yellow-100";
  if (level >= 1) return "border-sky-500/40 bg-sky-500/10 text-sky-100";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
}

function NewsIcon({ item }: { item: EmergencyNewsItem }) {
  if (item.type === "warning") return <Siren size={16} />;
  if (item.type === "hazard") return <AlertTriangle size={16} />;
  if (item.type === "traffic") return <Plane size={16} />;
  if (item.type === "response") return <ShieldCheck size={16} />;
  if (item.type === "guidance") return <Info size={16} />;
  return <Radio size={16} />;
}

export type BulletinImageType = "warning" | "weather" | "traffic" | "emergency" | "summary";
export type BulletinRatio = "1:1" | "4:5" | "3:4" | "16:9";
export type BulletinQuality = 1 | 2 | 3;
export type BulletinLocale = WarningRegion | "vietnam" | "thailand" | "malaysia" | "indonesia" | "singapore" | "cambodia" | "laos" | "northkorea" | "guam" | "brunei";

export interface BulletinImageData {
  region: WarningRegion;
  locale: BulletinLocale;
  countryName: string;
  warningSeverity: number;
  areaName: string;
  cityName: string;
  issuedAt: string;
  warningLabel: string;
  warningAuthority: string;
  warningReason: string;
  warningAction: string;
  bulletinHeadline?: string;
  bulletinBody?: string;
  defenseGuide?: string[];
  stationLat: number;
  stationLon: number;
  wind: number;
  gust: number;
  pressure: number;
  hourlyRain: number;
  rain6h: number;
  rain24h: number;
  waterDepthCm: number;
  stormSurge: number;
  airportName: string;
  airportStatus: string;
  airportLevel: number;
  transportLabel: string;
  transportLevel: number;
  transportDetail: string;
  preparedness: number;
  typhoonName: string;
  typhoonVmax: number;
  typhoonPmin: number;
}

type BulletinMakerProps = {
  data: BulletinImageData;
  onClose: () => void;
};

const TYPE_OPTIONS: Array<{ id: BulletinImageType; label: string; desc: string; icon: typeof FileText }> = [
  { id: "warning", label: "气象预警公告", desc: "突出当前预警、影响说明与防御指南", icon: AlertTriangle },
  { id: "weather", label: "气象实况公告", desc: "突出风、压、雨、积水与风暴增水", icon: FileText },
  { id: "traffic", label: "机场与交通公告", desc: "突出机场运行、道路/公交与出行提示", icon: Plane },
  { id: "emergency", label: "防灾应急公告", desc: "突出响应进度、积水与公众行动建议", icon: ShieldCheck },
  { id: "summary", label: "综合态势公告", desc: "将预警、实况、交通、防灾压缩到一张图", icon: ImageIcon }
];

const RATIOS: Array<{ id: BulletinRatio; label: string; w: number; h: number; desc: string }> = [
  { id: "1:1", label: "1:1 方图", w: 1080, h: 1080, desc: "社交平台/卡片" },
  { id: "4:5", label: "4:5 竖图", w: 1080, h: 1350, desc: "手机信息流" },
  { id: "3:4", label: "3:4 公告", w: 1080, h: 1440, desc: "公告/海报" },
  { id: "16:9", label: "16:9 横图", w: 1600, h: 900, desc: "屏幕/横版发布" }
];

const BULLETIN_MAKER_STORAGE_KEY = "aether-station-bulletin-maker-v2";

const QUALITY: Array<{ id: BulletinQuality; label: string; desc: string }> = [
  { id: 1, label: "标准", desc: "1×，适合快速分享" },
  { id: 2, label: "高清", desc: "2×，推荐" },
  { id: 3, label: "超清", desc: "3×，适合保存/打印" }
];

type BulletinCopy = {
  font: string;
  brand: string;
  simulationOnly: string;
  generatedBy: string;
  typeNames: Record<BulletinImageType, string>;
  labels: {
    sustainedWind: string; gust: string; pressure: string; hourlyRain: string; rain6h: string; rain24h: string;
    waterDepth: string; stormSurge: string; preparedness: string; airport: string; transport: string;
    observation: string; currentConditions: string; impacts: string; advice: string;
  };
  trafficStatus: string[];
  transportStatus: string[];
  generalGuide: string[];
  weatherSummary: (d: BulletinImageData) => string;
  emergencySummary: (d: BulletinImageData) => string;
  trafficSummary: (d: BulletinImageData, airport: string, transport: string) => string;
  summaryText: (d: BulletinImageData, airport: string, transport: string) => string;
  authority?: string;
  warningLabel?: (d: BulletinImageData) => string;
  warningSummary?: (d: BulletinImageData) => string;
};

const REPORT_COPIES: Record<WarningRegion, BulletinCopy> = {
  mainland: {
    font: 'system-ui, "Noto Sans SC", sans-serif', brand: "模拟气象防灾公告", simulationOnly: "仅供模拟 · 非现实生效公告", generatedBy: "TyphoonSIM 模拟生成",
    typeNames: { warning: "气象预警公告", weather: "气象实况公告", traffic: "机场与交通公告", emergency: "防灾应急公告", summary: "综合态势公告" },
    labels: { sustainedWind:"平均风", gust:"阵风", pressure:"气压", hourlyRain:"小时降水", rain6h:"近6小时", rain24h:"近24小时", waterDepth:"积水深度", stormSurge:"风暴增水", preparedness:"防灾准备", airport:"机场", transport:"地面交通", observation:"点位实况", currentConditions:"当前实况", impacts:"影响与提示", advice:"公众行动建议" },
    trafficStatus:["运行基本正常","流量限制 / 部分延误","流量限制 / 部分延误","大面积延误与取消","大面积停航 / 关闭准备"],
    transportStatus:["地面交通基本正常","交通限速与班次调整","交通限速与班次调整","部分线路停运 / 绕行","道路与公交大范围管制"],
    generalGuide:["远离低洼积水、河道、海堤、山坡和临时构筑物。","按当地指令做好停课停工、交通调整或人员转移准备。","持续关注后续模拟预警与风雨实况变化。"],
    weatherSummary:d=>`点位 ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E。平均风 ${d.wind.toFixed(1)} m/s，阵风 ${d.gust.toFixed(1)} m/s，气压 ${d.pressure.toFixed(1)} hPa，小时降水 ${d.hourlyRain.toFixed(1)} mm/h。`,
    emergencySummary:d=>`当前防灾准备进度 ${d.preparedness}%，低洼点积水约 ${d.waterDepthCm.toFixed(0)} cm，近24小时模拟降水 ${d.rain24h.toFixed(0)} mm。`,
    trafficSummary:(d,a,t)=>`${a}：${REPORT_COPIES.mainland.trafficStatus[Math.min(4,d.airportLevel)]}。${t}：${REPORT_COPIES.mainland.transportStatus[Math.min(4,d.transportLevel)]}。`,
    summaryText:(d,a,t)=>`${d.warningLabel}。${a}：${REPORT_COPIES.mainland.trafficStatus[Math.min(4,d.airportLevel)]}；${t}：${REPORT_COPIES.mainland.transportStatus[Math.min(4,d.transportLevel)]}。防灾准备 ${d.preparedness}%。`
  },
  hongkong: null as any, macau: null as any, taiwan: null as any,
  philippines: {
    font: 'Arial, Helvetica, system-ui, sans-serif', brand: "SIMULATED WEATHER & DISASTER BULLETIN", simulationOnly: "SIMULATION ONLY · NOT AN OFFICIAL BULLETIN", generatedBy: "Generated by TyphoonSIM simulation",
    typeNames: { warning:"Tropical Cyclone Warning Bulletin", weather:"Weather Conditions Bulletin", traffic:"Airport & Transport Bulletin", emergency:"Disaster Preparedness Bulletin", summary:"Situation Bulletin" },
    labels: { sustainedWind:"Sustained wind", gust:"Gust", pressure:"Pressure", hourlyRain:"Hourly rain", rain6h:"6-hour rain", rain24h:"24-hour rain", waterDepth:"Flood depth", stormSurge:"Storm surge", preparedness:"Preparedness", airport:"Airport", transport:"Ground transport", observation:"Station observation", currentConditions:"Current conditions", impacts:"Impacts and advisory", advice:"Public safety advice" },
    trafficStatus:["Normal operations","Flow restrictions / some delays","Flow restrictions / some delays","Major delays and cancellations","Widespread suspension / closure preparation"],
    transportStatus:["Ground transport generally normal","Speed limits and service adjustments","Speed limits and service adjustments","Partial suspension / rerouting","Widespread road and public-transport restrictions"],
    generalGuide:["Avoid floodways, rivers, coastal waters, steep slopes and light structures.","Follow evacuation, transport and local disaster-risk-reduction instructions.","Monitor subsequent simulated bulletins and observed wind and rainfall conditions."],
    weatherSummary:d=>`Station ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E. Sustained wind ${d.wind.toFixed(1)} m/s, gust ${d.gust.toFixed(1)} m/s, pressure ${d.pressure.toFixed(1)} hPa, hourly rainfall ${d.hourlyRain.toFixed(1)} mm/h.`,
    emergencySummary:d=>`Preparedness is ${d.preparedness}%. Estimated flood depth at susceptible low-lying locations is ${d.waterDepthCm.toFixed(0)} cm, with ${d.rain24h.toFixed(0)} mm simulated rainfall in 24 hours.`,
    trafficSummary:(d,a,t)=>`${a}: ${REPORT_COPIES.philippines.trafficStatus[Math.min(4,d.airportLevel)]}. ${t}: ${REPORT_COPIES.philippines.transportStatus[Math.min(4,d.transportLevel)]}.`,
    summaryText:(d,a,t)=>`${d.warningLabel}. ${a}: ${REPORT_COPIES.philippines.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${REPORT_COPIES.philippines.transportStatus[Math.min(4,d.transportLevel)]}. Preparedness ${d.preparedness}%.`
  },
  japan: {
    font: 'system-ui, "Noto Sans JP", sans-serif', brand: "気象・防災情報（シミュレーション）", simulationOnly: "シミュレーション専用 · 実際の警報ではありません", generatedBy: "TyphoonSIM シミュレーション生成",
    typeNames:{ warning:"台風・気象警報", weather:"気象実況", traffic:"空港・交通情報", emergency:"防災対応情報", summary:"総合状況" },
    labels:{ sustainedWind:"平均風速", gust:"最大瞬間風速", pressure:"気圧", hourlyRain:"1時間雨量", rain6h:"6時間雨量", rain24h:"24時間雨量", waterDepth:"浸水深", stormSurge:"高潮偏差", preparedness:"防災準備", airport:"空港", transport:"陸上交通", observation:"観測地点", currentConditions:"現在の状況", impacts:"影響と注意事項", advice:"安全確保" },
    trafficStatus:["概ね平常運航","流量制限・一部遅延","流量制限・一部遅延","大幅な遅延・欠航","広範囲の運航停止・閉鎖準備"],
    transportStatus:["陸上交通は概ね平常","速度規制・運行調整","速度規制・運行調整","一部運休・迂回","道路・公共交通の広範囲規制"],
    generalGuide:["海岸、河川、低い土地、崖、アンダーパスなど危険な場所に近づかないでください。","自治体の避難情報と交通機関の運行情報を確認してください。","今後のシミュレーション情報と風雨の実況を継続して確認してください。"],
    weatherSummary:d=>`観測地点 ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E。平均風速 ${d.wind.toFixed(1)} m/s、最大瞬間風速 ${d.gust.toFixed(1)} m/s、気圧 ${d.pressure.toFixed(1)} hPa、1時間雨量 ${d.hourlyRain.toFixed(1)} mm/h。`,
    emergencySummary:d=>`防災準備 ${d.preparedness}%。低い土地の推定浸水深 ${d.waterDepthCm.toFixed(0)} cm、24時間シミュレーション雨量 ${d.rain24h.toFixed(0)} mm。`,
    trafficSummary:(d,a,t)=>`${a}：${REPORT_COPIES.japan.trafficStatus[Math.min(4,d.airportLevel)]}。${t}：${REPORT_COPIES.japan.transportStatus[Math.min(4,d.transportLevel)]}。`,
    summaryText:(d,a,t)=>`${d.warningLabel}。${a}：${REPORT_COPIES.japan.trafficStatus[Math.min(4,d.airportLevel)]}。${t}：${REPORT_COPIES.japan.transportStatus[Math.min(4,d.transportLevel)]}。防災準備 ${d.preparedness}%。`
  },
  korea: {
    font: 'system-ui, "Noto Sans KR", sans-serif', brand:"기상·방재 정보 (모의)", simulationOnly:"모의 자료 · 실제 특보가 아닙니다", generatedBy:"TyphoonSIM 모의 생성",
    typeNames:{ warning:"태풍·기상특보", weather:"기상 실황", traffic:"공항·교통 정보", emergency:"방재 대응 정보", summary:"종합 상황" },
    labels:{ sustainedWind:"평균풍속", gust:"최대순간풍속", pressure:"기압", hourlyRain:"시간당 강수", rain6h:"6시간 강수", rain24h:"24시간 강수", waterDepth:"침수 깊이", stormSurge:"폭풍해일", preparedness:"방재 준비", airport:"공항", transport:"육상교통", observation:"관측 지점", currentConditions:"현재 실황", impacts:"영향 및 안내", advice:"안전 행동" },
    trafficStatus:["대체로 정상 운항","운항 제한·일부 지연","운항 제한·일부 지연","대규모 지연·결항","광범위 운항 중단·폐쇄 준비"],
    transportStatus:["육상교통 대체로 정상","감속·운행 조정","감속·운행 조정","일부 운휴·우회","도로·대중교통 광범위 통제"],
    generalGuide:["저지대·하천·해안·급경사지·임시 구조물에서 벗어나십시오.","지자체 대피 안내와 교통 통제 정보를 확인하십시오.","후속 모의 특보와 실제 풍우 변화를 계속 확인하십시오."],
    weatherSummary:d=>`관측 지점 ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E. 평균풍속 ${d.wind.toFixed(1)} m/s, 순간풍속 ${d.gust.toFixed(1)} m/s, 기압 ${d.pressure.toFixed(1)} hPa, 시간당 강수 ${d.hourlyRain.toFixed(1)} mm/h.`,
    emergencySummary:d=>`방재 준비 ${d.preparedness}%. 저지대 추정 침수 깊이 ${d.waterDepthCm.toFixed(0)} cm, 24시간 모의 강수량 ${d.rain24h.toFixed(0)} mm.`,
    trafficSummary:(d,a,t)=>`${a}: ${REPORT_COPIES.korea.trafficStatus[Math.min(4,d.airportLevel)]}. ${t}: ${REPORT_COPIES.korea.transportStatus[Math.min(4,d.transportLevel)]}.`,
    summaryText:(d,a,t)=>`${d.warningLabel}. ${a}: ${REPORT_COPIES.korea.trafficStatus[Math.min(4,d.airportLevel)]}. ${t}: ${REPORT_COPIES.korea.transportStatus[Math.min(4,d.transportLevel)]}. 방재 준비 ${d.preparedness}%.`
  },
  generic: null as any
};

function traditionalizeText(value: string): string {
  return String(value || "")
    .replaceAll("台风", "颱風").replaceAll("飓风", "颶風").replaceAll("烈风", "烈風")
    .replaceAll("强风", "強風").replaceAll("风力", "風力").replaceAll("增强", "增強")
    .replaceAll("信号", "信號").replaceAll("警报", "警報").replaceAll("预警", "預警")
    .replaceAll("模拟", "模擬").replaceAll("发布", "發布").replaceAll("陆上", "陸上")
    .replaceAll("无", "無").replaceAll("号", "號").replaceAll("影响", "影響");
}

const TRADITIONAL_COPY: BulletinCopy = {
  ...REPORT_COPIES.mainland,
  font: 'system-ui, "Noto Sans TC", sans-serif',
  brand:"模擬氣象防災公告", simulationOnly:"僅供模擬 · 非現實生效公告", generatedBy:"TyphoonSIM 模擬生成",
  typeNames:{ warning:"氣象預警公告", weather:"氣象實況公告", traffic:"機場與交通公告", emergency:"防災應急公告", summary:"綜合態勢公告" },
  labels:{ sustainedWind:"平均風", gust:"陣風", pressure:"氣壓", hourlyRain:"小時降雨", rain6h:"近6小時", rain24h:"近24小時", waterDepth:"積水深度", stormSurge:"風暴增水", preparedness:"防災準備", airport:"機場", transport:"地面交通", observation:"站點實況", currentConditions:"目前實況", impacts:"影響與提示", advice:"公眾行動建議" },
  trafficStatus:["運作大致正常","流量限制／部分延誤","流量限制／部分延誤","大範圍延誤與取消","大範圍停航／關閉準備"],
  transportStatus:["地面交通大致正常","交通限速與班次調整","交通限速與班次調整","部分路線停駛／改道","道路與公共交通大範圍管制"],
  generalGuide:["遠離低窪積水、河道、海堤、山坡及臨時構築物。","按當地指示做好停課停工、交通調整或人員轉移準備。","持續留意後續模擬警報及風雨實況變化。"],
  weatherSummary:d=>`站點 ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E。平均風 ${d.wind.toFixed(1)} m/s，陣風 ${d.gust.toFixed(1)} m/s，氣壓 ${d.pressure.toFixed(1)} hPa，小時降雨 ${d.hourlyRain.toFixed(1)} mm/h。`,
  emergencySummary:d=>`目前防災準備進度 ${d.preparedness}%，低窪點積水約 ${d.waterDepthCm.toFixed(0)} cm，近24小時模擬降雨 ${d.rain24h.toFixed(0)} mm。`,
  trafficSummary:(d,a,t)=>`${a}：${TRADITIONAL_COPY.trafficStatus[Math.min(4,d.airportLevel)]}。${t}：${TRADITIONAL_COPY.transportStatus[Math.min(4,d.transportLevel)]}。`,
  summaryText:(d,a,t)=>`${traditionalizeText(d.warningLabel)}。${a}：${TRADITIONAL_COPY.trafficStatus[Math.min(4,d.airportLevel)]}；${t}：${TRADITIONAL_COPY.transportStatus[Math.min(4,d.transportLevel)]}。防災準備 ${d.preparedness}%。`,
  warningLabel:d=>traditionalizeText(d.warningLabel),
  warningSummary:d=>`熱帶氣旋「${d.typhoonName}」可能影響本區。站點平均風 ${d.wind.toFixed(1)} m/s、陣風 ${d.gust.toFixed(1)} m/s，近24小時模擬降雨 ${d.rain24h.toFixed(0)} mm，低窪地區估算積水 ${d.waterDepthCm.toFixed(0)} cm。請依所在地氣象及防災部門指示採取行動。`
};
REPORT_COPIES.hongkong = TRADITIONAL_COPY;
REPORT_COPIES.macau = TRADITIONAL_COPY;
REPORT_COPIES.taiwan = TRADITIONAL_COPY;
REPORT_COPIES.generic = REPORT_COPIES.philippines;

const warningByLevel = (levels: string[]) => (d: BulletinImageData) => levels[Math.max(0, Math.min(levels.length - 1, Math.round(d.warningSeverity)))] || levels[0];

const LOCAL_REPORT_COPIES: Partial<Record<BulletinLocale, BulletinCopy>> = {
  generic: {
    ...REPORT_COPIES.philippines,
    brand:"SIMULATED WEATHER & DISASTER BULLETIN", simulationOnly:"SIMULATION ONLY · NOT AN OFFICIAL BULLETIN", generatedBy:"Generated by TyphoonSIM simulation", authority:"Local weather and emergency authority (simulated)",
    warningLabel:warningByLevel(["NO ACTIVE TROPICAL CYCLONE WARNING","TROPICAL CYCLONE WATCH","TROPICAL CYCLONE WARNING","SEVERE TROPICAL CYCLONE WARNING","DANGEROUS TROPICAL CYCLONE WARNING","EMERGENCY TROPICAL CYCLONE WARNING"]),
    warningSummary:d=>`Tropical cyclone ${d.typhoonName} may affect the area. Station wind is ${d.wind.toFixed(1)} m/s with gusts ${d.gust.toFixed(1)} m/s; simulated 24-hour rainfall is ${d.rain24h.toFixed(0)} mm and estimated low-lying flood depth is ${d.waterDepthCm.toFixed(0)} cm. Follow local authority instructions.`,
    summaryText:(d,a,t)=>`${LOCAL_REPORT_COPIES.generic!.warningLabel!(d)}. ${a}: ${LOCAL_REPORT_COPIES.generic!.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${LOCAL_REPORT_COPIES.generic!.transportStatus[Math.min(4,d.transportLevel)]}. Preparedness ${d.preparedness}%.`
  },
  vietnam: {
    font:'system-ui, "Noto Sans", Arial, sans-serif', brand:"BẢN TIN KHÍ TƯỢNG & PHÒNG CHỐNG THIÊN TAI (MÔ PHỎNG)", simulationOnly:"CHỈ MÔ PHỎNG · KHÔNG PHẢI CẢNH BÁO CHÍNH THỨC", generatedBy:"TyphoonSIM mô phỏng",
    typeNames:{ warning:"Bản tin cảnh báo bão", weather:"Bản tin thời tiết", traffic:"Bản tin sân bay & giao thông", emergency:"Bản tin ứng phó thiên tai", summary:"Bản tin tình hình tổng hợp" },
    labels:{ sustainedWind:"Gió duy trì", gust:"Gió giật", pressure:"Áp suất", hourlyRain:"Mưa theo giờ", rain6h:"Mưa 6 giờ", rain24h:"Mưa 24 giờ", waterDepth:"Độ sâu ngập", stormSurge:"Nước dâng", preparedness:"Mức sẵn sàng", airport:"Sân bay", transport:"Giao thông mặt đất", observation:"Quan trắc trạm", currentConditions:"Hiện trạng", impacts:"Tác động & khuyến cáo", advice:"Khuyến cáo an toàn" },
    trafficStatus:["Hoạt động bình thường","Hạn chế lưu lượng / chậm chuyến","Hạn chế lưu lượng / chậm chuyến","Chậm và hủy chuyến diện rộng","Tạm dừng diện rộng / chuẩn bị đóng cửa"],
    transportStatus:["Giao thông cơ bản bình thường","Hạn chế tốc độ / điều chỉnh dịch vụ","Hạn chế tốc độ / điều chỉnh dịch vụ","Tạm dừng một phần / chuyển hướng","Kiểm soát giao thông diện rộng"],
    generalGuide:["Tránh vùng trũng ngập, sông suối, bờ biển, sườn dốc và công trình tạm.","Tuân thủ hướng dẫn sơ tán, giao thông và phòng chống thiên tai của địa phương.","Tiếp tục theo dõi các bản tin mô phỏng và diễn biến gió mưa tại chỗ."],
    weatherSummary:d=>`Trạm ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E. Gió duy trì ${d.wind.toFixed(1)} m/s, gió giật ${d.gust.toFixed(1)} m/s, áp suất ${d.pressure.toFixed(1)} hPa, mưa theo giờ ${d.hourlyRain.toFixed(1)} mm/h.`,
    emergencySummary:d=>`Mức sẵn sàng hiện tại ${d.preparedness}%. Độ sâu ngập ước tính tại vùng trũng ${d.waterDepthCm.toFixed(0)} cm; lượng mưa mô phỏng 24 giờ ${d.rain24h.toFixed(0)} mm.`,
    trafficSummary:(d,a,t)=>`${a}: ${LOCAL_REPORT_COPIES.vietnam!.trafficStatus[Math.min(4,d.airportLevel)]}. ${t}: ${LOCAL_REPORT_COPIES.vietnam!.transportStatus[Math.min(4,d.transportLevel)]}.`,
    summaryText:(d,a,t)=>`${LOCAL_REPORT_COPIES.vietnam!.warningLabel!(d)}. ${a}: ${LOCAL_REPORT_COPIES.vietnam!.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${LOCAL_REPORT_COPIES.vietnam!.transportStatus[Math.min(4,d.transportLevel)]}. Mức sẵn sàng ${d.preparedness}%.`,
    authority:"Cơ quan khí tượng và phòng chống thiên tai địa phương (mô phỏng)",
    warningLabel:warningByLevel(["Chưa có cảnh báo bão","Theo dõi bão","Cảnh báo bão","Cảnh báo bão nghiêm trọng","Cảnh báo bão nguy hiểm","Cảnh báo bão đặc biệt nguy hiểm"]),
    warningSummary:d=>`Bão ${d.typhoonName} có thể ảnh hưởng khu vực. Gió tại trạm ${d.wind.toFixed(1)} m/s, gió giật ${d.gust.toFixed(1)} m/s; mưa 24 giờ ${d.rain24h.toFixed(0)} mm và ngập ước tính ${d.waterDepthCm.toFixed(0)} cm. Hãy theo dõi hướng dẫn của cơ quan địa phương.`
  },
  thailand: {
    font:'system-ui, "Noto Sans Thai", Tahoma, sans-serif', brand:"ข่าวอากาศและการป้องกันภัย (จำลอง)", simulationOnly:"สำหรับการจำลองเท่านั้น · ไม่ใช่ประกาศทางการ", generatedBy:"สร้างโดยการจำลอง TyphoonSIM",
    typeNames:{ warning:"ประกาศเตือนพายุ", weather:"รายงานสภาพอากาศ", traffic:"ประกาศสนามบินและการเดินทาง", emergency:"ประกาศการเตรียมพร้อมภัยพิบัติ", summary:"สรุปสถานการณ์" },
    labels:{ sustainedWind:"ลมเฉลี่ย", gust:"ลมกระโชก", pressure:"ความกดอากาศ", hourlyRain:"ฝนรายชั่วโมง", rain6h:"ฝน 6 ชม.", rain24h:"ฝน 24 ชม.", waterDepth:"ความลึกน้ำท่วม", stormSurge:"น้ำทะเลหนุน", preparedness:"ความพร้อม", airport:"สนามบิน", transport:"การเดินทางภาคพื้น", observation:"ข้อมูลสถานี", currentConditions:"สถานการณ์ปัจจุบัน", impacts:"ผลกระทบและคำแนะนำ", advice:"คำแนะนำความปลอดภัย" },
    trafficStatus:["เปิดให้บริการตามปกติ","จำกัดเที่ยวบิน / ล่าช้าบางส่วน","จำกัดเที่ยวบิน / ล่าช้าบางส่วน","ล่าช้าและยกเลิกจำนวนมาก","ระงับบริการวงกว้าง / เตรียมปิด"],
    transportStatus:["การเดินทางโดยรวมปกติ","จำกัดความเร็ว / ปรับบริการ","จำกัดความเร็ว / ปรับบริการ","หยุดบางส่วน / เปลี่ยนเส้นทาง","ควบคุมถนนและขนส่งสาธารณะวงกว้าง"],
    generalGuide:["หลีกเลี่ยงพื้นที่ลุ่มต่ำ ลำน้ำ ชายฝั่ง พื้นที่ลาดชัน และสิ่งปลูกสร้างชั่วคราว","ปฏิบัติตามคำสั่งอพยพและข้อจำกัดการเดินทางของหน่วยงานท้องถิ่น","ติดตามประกาศจำลองและสภาพลมฝนล่าสุดอย่างต่อเนื่อง"],
    weatherSummary:d=>`สถานี ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E ลมเฉลี่ย ${d.wind.toFixed(1)} m/s ลมกระโชก ${d.gust.toFixed(1)} m/s ความกด ${d.pressure.toFixed(1)} hPa ฝนรายชั่วโมง ${d.hourlyRain.toFixed(1)} mm/h`,
    emergencySummary:d=>`ความพร้อม ${d.preparedness}% คาดระดับน้ำท่วมพื้นที่ลุ่มต่ำ ${d.waterDepthCm.toFixed(0)} ซม. และฝนจำลอง 24 ชม. ${d.rain24h.toFixed(0)} มม.`,
    trafficSummary:(d,a,t)=>`${a}: ${LOCAL_REPORT_COPIES.thailand!.trafficStatus[Math.min(4,d.airportLevel)]} ${t}: ${LOCAL_REPORT_COPIES.thailand!.transportStatus[Math.min(4,d.transportLevel)]}`,
    summaryText:(d,a,t)=>`${LOCAL_REPORT_COPIES.thailand!.warningLabel!(d)} ${a}: ${LOCAL_REPORT_COPIES.thailand!.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${LOCAL_REPORT_COPIES.thailand!.transportStatus[Math.min(4,d.transportLevel)]} ความพร้อม ${d.preparedness}%`,
    authority:"หน่วยงานอุตุนิยมวิทยาและป้องกันภัยท้องถิ่น (จำลอง)",
    warningLabel:warningByLevel(["ไม่มีคำเตือนพายุ","เฝ้าระวังพายุหมุนเขตร้อน","เตือนภัยพายุหมุนเขตร้อน","เตือนภัยระดับรุนแรง","เตือนภัยระดับอันตรายมาก","เตือนภัยขั้นสูงสุด"]),
    warningSummary:d=>`พายุ ${d.typhoonName} อาจส่งผลต่อพื้นที่ ลมที่สถานี ${d.wind.toFixed(1)} m/s ลมกระโชก ${d.gust.toFixed(1)} m/s ฝน 24 ชม. ${d.rain24h.toFixed(0)} มม. และคาดน้ำท่วม ${d.waterDepthCm.toFixed(0)} ซม. โปรดติดตามคำแนะนำจากหน่วยงานท้องถิ่น`
  },
  malaysia: {
    font:'Arial, system-ui, sans-serif', brand:"BULETIN CUACA & KESIAPSIAGAAN BENCANA (SIMULASI)", simulationOnly:"SIMULASI SAHAJA · BUKAN AMARAN RASMI", generatedBy:"Dijana oleh simulasi TyphoonSIM",
    typeNames:{ warning:"Buletin amaran siklon tropika", weather:"Buletin cuaca semasa", traffic:"Buletin lapangan terbang & pengangkutan", emergency:"Buletin kesiapsiagaan bencana", summary:"Buletin situasi" },
    labels:{ sustainedWind:"Angin berterusan", gust:"Tiupan", pressure:"Tekanan", hourlyRain:"Hujan sejam", rain6h:"Hujan 6 jam", rain24h:"Hujan 24 jam", waterDepth:"Kedalaman banjir", stormSurge:"Limpahan ribut", preparedness:"Kesiapsiagaan", airport:"Lapangan terbang", transport:"Pengangkutan darat", observation:"Pemerhatian stesen", currentConditions:"Keadaan semasa", impacts:"Kesan & nasihat", advice:"Nasihat keselamatan" },
    trafficStatus:["Operasi normal","Sekatan aliran / sedikit kelewatan","Sekatan aliran / sedikit kelewatan","Kelewatan dan pembatalan besar","Penggantungan meluas / persediaan penutupan"],
    transportStatus:["Pengangkutan darat umumnya normal","Had laju / pelarasan perkhidmatan","Had laju / pelarasan perkhidmatan","Penggantungan separa / lencongan","Kawalan jalan dan transit secara meluas"],
    generalGuide:["Jauhi kawasan rendah, sungai, pesisir, cerun curam dan struktur ringan.","Patuhi arahan pemindahan serta kawalan perjalanan pihak berkuasa tempatan.","Pantau buletin simulasi seterusnya dan keadaan angin serta hujan semasa."],
    weatherSummary:d=>`Stesen ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E. Angin ${d.wind.toFixed(1)} m/s, tiupan ${d.gust.toFixed(1)} m/s, tekanan ${d.pressure.toFixed(1)} hPa, hujan sejam ${d.hourlyRain.toFixed(1)} mm/h.`,
    emergencySummary:d=>`Kesiapsiagaan ${d.preparedness}%. Anggaran banjir di kawasan rendah ${d.waterDepthCm.toFixed(0)} cm; hujan simulasi 24 jam ${d.rain24h.toFixed(0)} mm.`,
    trafficSummary:(d,a,t)=>`${a}: ${LOCAL_REPORT_COPIES.malaysia!.trafficStatus[Math.min(4,d.airportLevel)]}. ${t}: ${LOCAL_REPORT_COPIES.malaysia!.transportStatus[Math.min(4,d.transportLevel)]}.`,
    summaryText:(d,a,t)=>`${LOCAL_REPORT_COPIES.malaysia!.warningLabel!(d)}. ${a}: ${LOCAL_REPORT_COPIES.malaysia!.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${LOCAL_REPORT_COPIES.malaysia!.transportStatus[Math.min(4,d.transportLevel)]}. Kesiapsiagaan ${d.preparedness}%.`,
    authority:"Agensi meteorologi dan pengurusan bencana tempatan (simulasi)",
    warningLabel:warningByLevel(["Tiada amaran siklon tropika","Waspada siklon tropika","Amaran siklon tropika","Amaran ribut kuat","Amaran bahaya tinggi","Amaran kecemasan"]),
    warningSummary:d=>`Siklon ${d.typhoonName} mungkin menjejaskan kawasan ini. Angin stesen ${d.wind.toFixed(1)} m/s, tiupan ${d.gust.toFixed(1)} m/s, hujan 24 jam ${d.rain24h.toFixed(0)} mm dan anggaran banjir ${d.waterDepthCm.toFixed(0)} cm. Ikuti arahan pihak berkuasa tempatan.`
  },
  indonesia: {
    font:'Arial, system-ui, sans-serif', brand:"BULETIN CUACA & KESIAPSIAGAAN BENCANA (SIMULASI)", simulationOnly:"HANYA SIMULASI · BUKAN PERINGATAN RESMI", generatedBy:"Dibuat oleh simulasi TyphoonSIM",
    typeNames:{ warning:"Buletin peringatan siklon tropis", weather:"Buletin cuaca terkini", traffic:"Buletin bandara & transportasi", emergency:"Buletin kesiapsiagaan bencana", summary:"Buletin situasi" },
    labels:{ sustainedWind:"Angin berkelanjutan", gust:"Hembusan", pressure:"Tekanan", hourlyRain:"Hujan per jam", rain6h:"Hujan 6 jam", rain24h:"Hujan 24 jam", waterDepth:"Kedalaman banjir", stormSurge:"Gelombang pasang", preparedness:"Kesiapsiagaan", airport:"Bandara", transport:"Transportasi darat", observation:"Observasi stasiun", currentConditions:"Kondisi saat ini", impacts:"Dampak & imbauan", advice:"Imbauan keselamatan" },
    trafficStatus:["Operasi normal","Pembatasan / sebagian tertunda","Pembatasan / sebagian tertunda","Penundaan dan pembatalan besar","Penghentian luas / persiapan penutupan"],
    transportStatus:["Transportasi darat umumnya normal","Batas kecepatan / penyesuaian layanan","Batas kecepatan / penyesuaian layanan","Penghentian sebagian / pengalihan","Pembatasan jalan dan angkutan umum secara luas"],
    generalGuide:["Hindari dataran rendah, sungai, pesisir, lereng curam, dan bangunan ringan.","Ikuti arahan evakuasi dan pengaturan perjalanan dari pemerintah daerah.","Pantau buletin simulasi berikutnya serta perkembangan angin dan hujan."],
    weatherSummary:d=>`Stasiun ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E. Angin ${d.wind.toFixed(1)} m/s, hembusan ${d.gust.toFixed(1)} m/s, tekanan ${d.pressure.toFixed(1)} hPa, hujan per jam ${d.hourlyRain.toFixed(1)} mm/h.`,
    emergencySummary:d=>`Kesiapsiagaan ${d.preparedness}%. Perkiraan genangan di area rendah ${d.waterDepthCm.toFixed(0)} cm; hujan simulasi 24 jam ${d.rain24h.toFixed(0)} mm.`,
    trafficSummary:(d,a,t)=>`${a}: ${LOCAL_REPORT_COPIES.indonesia!.trafficStatus[Math.min(4,d.airportLevel)]}. ${t}: ${LOCAL_REPORT_COPIES.indonesia!.transportStatus[Math.min(4,d.transportLevel)]}.`,
    summaryText:(d,a,t)=>`${LOCAL_REPORT_COPIES.indonesia!.warningLabel!(d)}. ${a}: ${LOCAL_REPORT_COPIES.indonesia!.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${LOCAL_REPORT_COPIES.indonesia!.transportStatus[Math.min(4,d.transportLevel)]}. Kesiapsiagaan ${d.preparedness}%.`,
    authority:"Badan meteorologi dan penanggulangan bencana setempat (simulasi)",
    warningLabel:warningByLevel(["Tidak ada peringatan siklon","Waspada siklon tropis","Peringatan siklon tropis","Peringatan cuaca ekstrem","Peringatan bahaya tinggi","Peringatan darurat"]),
    warningSummary:d=>`Siklon ${d.typhoonName} dapat memengaruhi wilayah ini. Angin stasiun ${d.wind.toFixed(1)} m/s, hembusan ${d.gust.toFixed(1)} m/s, hujan 24 jam ${d.rain24h.toFixed(0)} mm, dan perkiraan genangan ${d.waterDepthCm.toFixed(0)} cm. Ikuti arahan pemerintah daerah.`
  },
  singapore: {
    ...REPORT_COPIES.philippines,
    brand:"SIMULATED WEATHER & EMERGENCY BULLETIN", generatedBy:"Generated by TyphoonSIM simulation", authority:"Local weather and emergency authorities (simulated)",
    warningLabel:warningByLevel(["NO ACTIVE TROPICAL CYCLONE WARNING","TROPICAL CYCLONE WATCH","TROPICAL CYCLONE ADVISORY","SEVERE WEATHER WARNING","DANGEROUS WEATHER WARNING","EMERGENCY WARNING"]),
    warningSummary:d=>`Tropical cyclone ${d.typhoonName} may affect the area. Station wind is ${d.wind.toFixed(1)} m/s with gusts ${d.gust.toFixed(1)} m/s; simulated 24-hour rainfall is ${d.rain24h.toFixed(0)} mm and estimated low-lying flood depth is ${d.waterDepthCm.toFixed(0)} cm. Follow local authority instructions.`
  },
  cambodia: {
    font:'system-ui, "Noto Sans Khmer", Arial, sans-serif', brand:"ព្រឹត្តិបត្រអាកាសធាតុ និងការពារគ្រោះមហន្តរាយ (ស៊ីម្យូឡេសិន)", simulationOnly:"សម្រាប់ការស៊ីម្យូឡេសិនប៉ុណ្ណោះ · មិនមែនជាសេចក្តីប្រកាសផ្លូវការ", generatedBy:"បង្កើតដោយ TyphoonSIM",
    typeNames:{ warning:"សេចក្តីព្រមានព្យុះ", weather:"ព្រឹត្តិបត្រអាកាសធាតុ", traffic:"ព្រឹត្តិបត្រអាកាសយានដ្ឋាន និងចរាចរណ៍", emergency:"ព្រឹត្តិបត្រត្រៀមគ្រោះមហន្តរាយ", summary:"សង្ខេបស្ថានភាព" },
    labels:{ sustainedWind:"ល្បឿនខ្យល់", gust:"ខ្យល់កន្ត្រាក់", pressure:"សម្ពាធ", hourlyRain:"ភ្លៀងក្នុងមួយម៉ោង", rain6h:"ភ្លៀង 6 ម៉ោង", rain24h:"ភ្លៀង 24 ម៉ោង", waterDepth:"ជម្រៅទឹកជំនន់", stormSurge:"ទឹកសមុទ្រកើន", preparedness:"កម្រិតត្រៀម", airport:"អាកាសយានដ្ឋាន", transport:"ចរាចរណ៍ផ្លូវគោក", observation:"ទិន្នន័យស្ថានីយ", currentConditions:"ស្ថានភាពបច្ចុប្បន្ន", impacts:"ផលប៉ះពាល់ និងការណែនាំ", advice:"ការណែនាំសុវត្ថិភាព" },
    trafficStatus:["ដំណើរការធម្មតា","មានការកម្រិត និងពន្យារ","មានការកម្រិត និងពន្យារ","ពន្យារ និងលុបជើងហោះហើរច្រើន","ផ្អាកទូលំទូលាយ"], transportStatus:["ចរាចរណ៍ធម្មតា","កម្រិតល្បឿន / កែសម្រួលសេវា","កម្រិតល្បឿន / កែសម្រួលសេវា","ផ្អាកខ្លះ / ប្តូរផ្លូវ","គ្រប់គ្រងចរាចរណ៍ទូលំទូលាយ"],
    generalGuide:["ជៀសវាងតំបន់ទាប ទន្លេ ឆ្នេរសមុទ្រ ជម្រាល និងសំណង់មិនរឹងមាំ។","អនុវត្តតាមការណែនាំជម្លៀស និងចរាចរណ៍របស់អាជ្ញាធរមូលដ្ឋាន។","បន្តតាមដានព្រឹត្តិបត្រស៊ីម្យូឡេសិន និងស្ថានភាពខ្យល់ភ្លៀង។"],
    weatherSummary:d=>`ស្ថានីយ ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E។ ខ្យល់ ${d.wind.toFixed(1)} m/s កន្ត្រាក់ ${d.gust.toFixed(1)} m/s សម្ពាធ ${d.pressure.toFixed(1)} hPa ភ្លៀង ${d.hourlyRain.toFixed(1)} mm/h។`, emergencySummary:d=>`កម្រិតត្រៀម ${d.preparedness}%។ ជម្រៅទឹកជំនន់ប៉ាន់ស្មាន ${d.waterDepthCm.toFixed(0)} cm និងភ្លៀង 24 ម៉ោង ${d.rain24h.toFixed(0)} mm។`,
    trafficSummary:(d,a,t)=>`${a}: ${LOCAL_REPORT_COPIES.cambodia!.trafficStatus[Math.min(4,d.airportLevel)]}។ ${t}: ${LOCAL_REPORT_COPIES.cambodia!.transportStatus[Math.min(4,d.transportLevel)]}។`, summaryText:(d,a,t)=>`${LOCAL_REPORT_COPIES.cambodia!.warningLabel!(d)}។ ${a}: ${LOCAL_REPORT_COPIES.cambodia!.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${LOCAL_REPORT_COPIES.cambodia!.transportStatus[Math.min(4,d.transportLevel)]}។`, authority:"អាជ្ញាធរឧតុនិយម និងគ្រប់គ្រងគ្រោះមហន្តរាយមូលដ្ឋាន (ស៊ីម្យូឡេសិន)", warningLabel:warningByLevel(["មិនមានការព្រមានព្យុះ","តាមដានព្យុះ","ព្រមានព្យុះត្រូពិច","ព្រមានធ្ងន់ធ្ងរ","ព្រមានគ្រោះថ្នាក់ខ្ពស់","ព្រមានបន្ទាន់"]), warningSummary:d=>`ព្យុះ ${d.typhoonName} អាចប៉ះពាល់តំបន់នេះ។ ខ្យល់ ${d.wind.toFixed(1)} m/s កន្ត្រាក់ ${d.gust.toFixed(1)} m/s ភ្លៀង 24 ម៉ោង ${d.rain24h.toFixed(0)} mm និងជម្រៅទឹកប៉ាន់ស្មាន ${d.waterDepthCm.toFixed(0)} cm។`
  },
  laos: {
    font:'system-ui, "Noto Sans Lao", Arial, sans-serif', brand:"ຂ່າວອາກາດ ແລະ ການປ້ອງກັນໄພ (ຈຳລອງ)", simulationOnly:"ສຳລັບການຈຳລອງເທົ່ານັ້ນ · ບໍ່ແມ່ນຄຳເຕືອນທາງການ", generatedBy:"ສ້າງໂດຍ TyphoonSIM",
    typeNames:{ warning:"ແຈ້ງເຕືອນພາຍຸ", weather:"ຂ່າວອາກາດ", traffic:"ສະໜາມບິນ ແລະ ການເດີນທາງ", emergency:"ການກຽມພ້ອມໄພພິບັດ", summary:"ສະຫຼຸບສະຖານະການ" },
    labels:{ sustainedWind:"ລົມສະເລ່ຍ", gust:"ລົມກະໂຊກ", pressure:"ຄວາມກົດອາກາດ", hourlyRain:"ຝົນຕໍ່ຊົ່ວໂມງ", rain6h:"ຝົນ 6 ຊົ່ວໂມງ", rain24h:"ຝົນ 24 ຊົ່ວໂມງ", waterDepth:"ຄວາມເລິກນ້ຳຖ້ວມ", stormSurge:"ນ້ຳທະເລໜຸນ", preparedness:"ຄວາມພ້ອມ", airport:"ສະໜາມບິນ", transport:"ການເດີນທາງທາງບົກ", observation:"ຂໍ້ມູນສະຖານີ", currentConditions:"ສະພາບປັດຈຸບັນ", impacts:"ຜົນກະທົບ ແລະ ຄຳແນະນຳ", advice:"ຄຳແນະນຳຄວາມປອດໄພ" },
    trafficStatus:["ປົກກະຕິ","ຈຳກັດ / ຊັກຊ້າບາງສ່ວນ","ຈຳກັດ / ຊັກຊ້າບາງສ່ວນ","ຊັກຊ້າ ແລະ ຍົກເລີກຫຼາຍ","ຢຸດບໍລິການຢ່າງກວ້າງ"], transportStatus:["ການເດີນທາງປົກກະຕິ","ຈຳກັດຄວາມໄວ / ປັບບໍລິການ","ຈຳກັດຄວາມໄວ / ປັບບໍລິການ","ຢຸດບາງສ່ວນ / ປ່ຽນເສັ້ນທາງ","ຄວບຄຸມຈາລະຈອນຢ່າງກວ້າງ"],
    generalGuide:["ຫຼີກລ້ຽງພື້ນທີ່ຕ່ຳ ແມ່ນ້ຳ ຊາຍຝັ່ງ ພູຊັນ ແລະ ສິ່ງປຸກສ້າງບໍ່ແຂງແຮງ.","ປະຕິບັດຕາມຄຳສັ່ງອົບພະຍົບ ແລະ ການເດີນທາງຂອງທ້ອງຖິ່ນ.","ຕິດຕາມຂ່າວຈຳລອງ ແລະ ສະພາບລົມຝົນຕໍ່ໄປ."],
    weatherSummary:d=>`ສະຖານີ ${d.stationLat.toFixed(3)}°N, ${d.stationLon.toFixed(3)}°E. ລົມ ${d.wind.toFixed(1)} m/s, ລົມກະໂຊກ ${d.gust.toFixed(1)} m/s, ຄວາມກົດ ${d.pressure.toFixed(1)} hPa, ຝົນ ${d.hourlyRain.toFixed(1)} mm/h.`, emergencySummary:d=>`ຄວາມພ້ອມ ${d.preparedness}%. ຄາດນ້ຳຖ້ວມ ${d.waterDepthCm.toFixed(0)} cm ແລະ ຝົນ 24 ຊົ່ວໂມງ ${d.rain24h.toFixed(0)} mm.`,
    trafficSummary:(d,a,t)=>`${a}: ${LOCAL_REPORT_COPIES.laos!.trafficStatus[Math.min(4,d.airportLevel)]}. ${t}: ${LOCAL_REPORT_COPIES.laos!.transportStatus[Math.min(4,d.transportLevel)]}.`, summaryText:(d,a,t)=>`${LOCAL_REPORT_COPIES.laos!.warningLabel!(d)}. ${a}: ${LOCAL_REPORT_COPIES.laos!.trafficStatus[Math.min(4,d.airportLevel)]}; ${t}: ${LOCAL_REPORT_COPIES.laos!.transportStatus[Math.min(4,d.transportLevel)]}.`, authority:"ອົງການອຸຕຸນິຍົມ ແລະ ຈັດການໄພທ້ອງຖິ່ນ (ຈຳລອງ)", warningLabel:warningByLevel(["ບໍ່ມີຄຳເຕືອນພາຍຸ","ເຝົ້າລະວັງພາຍຸ","ແຈ້ງເຕືອນພາຍຸເຂດຮ້ອນ","ແຈ້ງເຕືອນຮຸນແຮງ","ແຈ້ງເຕືອນອັນຕະລາຍສູງ","ແຈ້ງເຕືອນສຸກເສີນ"]), warningSummary:d=>`ພາຍຸ ${d.typhoonName} ອາດກະທົບພື້ນທີ່. ລົມ ${d.wind.toFixed(1)} m/s, ລົມກະໂຊກ ${d.gust.toFixed(1)} m/s, ຝົນ 24 ຊົ່ວໂມງ ${d.rain24h.toFixed(0)} mm ແລະ ຄາດນ້ຳຖ້ວມ ${d.waterDepthCm.toFixed(0)} cm.`
  },
  northkorea: {
    ...REPORT_COPIES.korea,
    brand:"기상·재해방지 정보 (모의)", generatedBy:"TyphoonSIM 모의 생성", authority:"지역 기상·재해방지 기관 (모의)",
    warningLabel:warningByLevel(["태풍경보 없음","태풍 감시","태풍주의보","태풍경보","심각한 태풍경보","최고 단계 경보"]),
    warningSummary:d=>`태풍 ${d.typhoonName}의 영향 가능성이 있습니다. 관측 지점 평균풍속 ${d.wind.toFixed(1)} m/s, 순간풍속 ${d.gust.toFixed(1)} m/s, 24시간 모의 강수 ${d.rain24h.toFixed(0)} mm, 저지대 추정 침수 ${d.waterDepthCm.toFixed(0)} cm입니다. 지역 방재 지시에 따르십시오.`
  },
  guam: {
    ...REPORT_COPIES.philippines,
    brand:"SIMULATED TROPICAL CYCLONE & EMERGENCY BULLETIN", generatedBy:"Generated by TyphoonSIM simulation", authority:"Local weather and emergency authorities (simulated)",
    warningLabel:warningByLevel(["NO ACTIVE TROPICAL CYCLONE WARNING","TROPICAL CYCLONE WATCH","TROPICAL CYCLONE WARNING","TYPHOON WARNING","EXTREME TYPHOON WARNING","EMERGENCY WARNING"]),
    warningSummary:d=>`Tropical cyclone ${d.typhoonName} may affect Guam. Station wind is ${d.wind.toFixed(1)} m/s with gusts ${d.gust.toFixed(1)} m/s; simulated 24-hour rainfall is ${d.rain24h.toFixed(0)} mm and estimated low-lying flood depth is ${d.waterDepthCm.toFixed(0)} cm.`
  },
  brunei: {
    ...REPORT_COPIES.philippines,
    brand:"BULETIN CUACA & KESIAPSIAGAAN BENCANA (SIMULASI)", simulationOnly:"SIMULASI SAHAJA · BUKAN AMARAN RASMI", generatedBy:"Dijana oleh simulasi TyphoonSIM", authority:"Agensi cuaca dan pengurusan bencana tempatan (simulasi)",
    warningLabel:warningByLevel(["Tiada amaran siklon tropika","Waspada siklon tropika","Amaran siklon tropika","Amaran ribut kuat","Amaran bahaya tinggi","Amaran kecemasan"]),
    warningSummary:d=>`Siklon ${d.typhoonName} mungkin menjejaskan kawasan ini. Angin stesen ${d.wind.toFixed(1)} m/s, tiupan ${d.gust.toFixed(1)} m/s, hujan 24 jam ${d.rain24h.toFixed(0)} mm dan anggaran banjir ${d.waterDepthCm.toFixed(0)} cm.`
  }
};

function getReportCopy(locale: BulletinLocale): BulletinCopy {
  return LOCAL_REPORT_COPIES[locale] || REPORT_COPIES[locale as WarningRegion] || REPORT_COPIES.generic;
}

function resolveBulletinLocale(region: WarningRegion, country: string, city: string, lat: number, lon: number): BulletinLocale {
  const key = `${country} ${city}`.toLowerCase();
  if (/越南|vietnam|viet nam/.test(key)) return "vietnam";
  if (/泰国|thailand/.test(key)) return "thailand";
  if (/马来西亚|馬來西亞|malaysia/.test(key)) return "malaysia";
  if (/印度尼西亚|印尼|indonesia/.test(key)) return "indonesia";
  if (/新加坡|singapore/.test(key)) return "singapore";
  if (/柬埔寨|cambodia/.test(key)) return "cambodia";
  if (/老挝|寮國|laos|lao pdr/.test(key)) return "laos";
  if (/朝鲜|朝鮮|north korea|democratic people/.test(key)) return "northkorea";
  if (/关岛|關島|guam/.test(key)) return "guam";
  if (/文莱|汶萊|brunei/.test(key)) return "brunei";
  if (region !== "generic") return region;
  // Offline/fallback stations may have no country string. Conservative coordinate gates cover the
  // simulator's western-Pacific domain without overriding a known country from reverse geocoding.
  if (lat >= 8 && lat <= 23.6 && lon >= 102 && lon <= 109.1) return "vietnam";
  if (lat >= 5 && lat <= 21 && lon >= 97 && lon <= 105.5) return "thailand";
  if (lat >= -11.5 && lat <= 6.5 && lon >= 95 && lon <= 141.5) return "indonesia";
  if (lat >= 13 && lat <= 14.7 && lon >= 144 && lon <= 145.2) return "guam";
  return "generic";
}

const LOCAL_PLACE_REPLACEMENTS: Partial<Record<BulletinLocale, Array<[string,string]>>> = {
  philippines: [["巴伦苏埃拉市","Valenzuela"],["巴伦苏埃拉","Valenzuela"],["马尼拉","Manila"],["奎松市","Quezon City"],["奎松","Quezon City"],["帕赛","Pasay"],["马卡蒂","Makati"],["帕拉尼亚克","Parañaque"],["宿务","Cebu City"],["黎牙实比","Legazpi"],["塔克洛班","Tacloban"],["苏里高","Surigao City"],["土格加劳","Tuguegarao"],["佬沃","Laoag"],["维甘","Vigan"],["达沃","Davao City"]],
  japan: [["东京","東京都"],["大阪","大阪府"],["那霸","那覇市"],["鹿儿岛","鹿児島市"],["福冈","福岡市"],["长崎","長崎市"],["高知","高知市"],["名古屋","名古屋市"],["横滨","横浜市"],["石垣岛","石垣市"]],
  korea: [["首尔","서울"],["釜山","부산"],["济州","제주"],["仁川","인천"],["江陵","강릉"],["束草","속초"]],
  northkorea: [["平壤","평양"],["元山","원산"],["咸兴","함흥"],["清津","청진"]],
  taiwan: [["台北","臺北"],["台东","臺東"],["台南","臺南"],["台中","臺中"]],
  vietnam: [["河内","Hà Nội"],["下龙市","Hạ Long"],["下龙","Hạ Long"],["海防市","Hải Phòng"],["海防","Hải Phòng"],["清化市","Thanh Hóa"],["清化","Thanh Hóa"],["荣市","Vinh"],["荣","Vinh"],["顺化市","Huế"],["顺化","Huế"],["岘港市","Đà Nẵng"],["岘港","Đà Nẵng"],["广义市","Quảng Ngãi"],["广义","Quảng Ngãi"],["归仁市","Quy Nhơn"],["归仁","Quy Nhơn"],["芽庄市","Nha Trang"],["芽庄","Nha Trang"],["胡志明市","TP. Hồ Chí Minh"],["胡志明","TP. Hồ Chí Minh"]],
  thailand: [["曼谷","กรุงเทพมหานคร"],["清迈","เชียงใหม่"],["普吉","ภูเก็ต"],["宋卡","สงขลา"]],
  malaysia: [["吉隆坡","Kuala Lumpur"],["亚庇","Kota Kinabalu"],["古晋","Kuching"],["哥打巴鲁","Kota Bharu"]],
  indonesia: [["雅加达","Jakarta"],["泗水","Surabaya"],["棉兰","Medan"],["望加锡","Makassar"],["万鸦老","Manado"]],
  singapore: [["新加坡","Singapore"]],
  cambodia: [["金边","ភ្នំពេញ"],["西哈努克","ព្រះសីហនុ"]],
  laos: [["万象","ວຽງຈັນ"],["沙湾拿吉","ສະຫວັນນະເຂດ"]],
  guam: [["阿加尼亚","Hagåtña"],["关岛","Guam"]],
  brunei: [["斯里巴加湾","Bandar Seri Begawan"],["文莱","Brunei"]]
};

const FALLBACK_AREA: Partial<Record<BulletinLocale,string>> = {
  philippines:"Affected Area", vietnam:"Khu vực ảnh hưởng", thailand:"พื้นที่ได้รับผลกระทบ", malaysia:"Kawasan terjejas", indonesia:"Wilayah terdampak", singapore:"Affected Area", cambodia:"តំបន់រងផលប៉ះពាល់", laos:"ພື້ນທີ່ທີ່ໄດ້ຮັບຜົນກະທົບ", northkorea:"영향 지역", guam:"Affected Area", brunei:"Kawasan terjejas"
};

function localizePlaceName(value: string, locale: BulletinLocale): string {
  let out = String(value || "").trim();
  for (const [from,to] of LOCAL_PLACE_REPLACEMENTS[locale] || []) out = out.replaceAll(from,to);
  if (locale === "philippines") out = out.replace(/市(?=\s|\d|$)/g, "").replace(/區/g, " District");
  // Reverse-geocoded district labels can concatenate a translated Latin city with an ordinal
  // (e.g. Valenzuela1st District). Restore the natural word boundary in exported bulletins.
  if (["philippines","vietnam","malaysia","indonesia","singapore","guam","brunei","generic"].includes(locale)) {
    out = out.replace(/([A-Za-zÀ-ỹ])(?=\d)/g, "$1 ").replace(/\s{2,}/g, " ").trim();
  }
  if (locale === "hongkong" || locale === "macau" || locale === "taiwan") out = traditionalizeText(out);
  const nonCjkLocale = ["philippines","vietnam","thailand","malaysia","indonesia","singapore","cambodia","laos","guam","brunei"].includes(locale);
  if (nonCjkLocale && /[\u3400-\u9fff]/.test(out)) return FALLBACK_AREA[locale] || "Affected Area";
  return out || FALLBACK_AREA[locale] || (locale === "japan" ? "対象地域" : locale === "korea" || locale === "northkorea" ? "영향 지역" : "影響區域");
}

function localizeAirportName(data: BulletinImageData): string {
  const raw = String(data.airportName || "");
  const hasCjk = /[\u3400-\u9fff]/.test(raw);
  if (!hasCjk) return raw;
  const city = localizePlaceName(data.cityName || data.areaName, data.locale);
  if (data.locale === "philippines") return `${city} Regional Airport`;
  if (data.locale === "japan") return `${city} 主要空港`;
  if (data.locale === "korea" || data.locale === "northkorea") return `${city} 주요 공항`;
  if (data.locale === "vietnam") return `Sân bay chính ${city}`;
  if (data.locale === "thailand") return `ท่าอากาศยานหลัก ${city}`;
  if (data.locale === "malaysia" || data.locale === "brunei") return `Lapangan terbang utama ${city}`;
  if (data.locale === "indonesia") return `Bandara utama ${city}`;
  if (data.locale === "singapore") return "Singapore Changi Airport";
  if (data.locale === "cambodia") return `អាកាសយានដ្ឋានសំខាន់ ${city}`;
  if (data.locale === "laos") return `ສະໜາມບິນຫຼັກ ${city}`;
  if (data.locale === "guam") return "Guam International Airport";
  return raw;
}

const BULLETIN_INTL_LOCALE: Partial<Record<BulletinLocale,string>> = {
  mainland:"zh-CN", hongkong:"zh-HK", macau:"zh-MO", taiwan:"zh-TW", philippines:"en-PH", japan:"ja-JP", korea:"ko-KR", vietnam:"vi-VN", thailand:"th-TH", malaysia:"ms-MY", indonesia:"id-ID", singapore:"en-SG", cambodia:"km-KH", laos:"lo-LA", northkorea:"ko-KP", guam:"en-US", brunei:"ms-BN", generic:"en"
};

function formatBulletinImageTime(locale: BulletinLocale, startDate: Date | undefined, simHour: number): string {
  const base = startDate instanceof Date && Number.isFinite(startDate.getTime()) ? startDate.getTime() : Date.now();
  const date = new Date(base + Math.max(0, simHour) * 3600000);
  try {
    return new Intl.DateTimeFormat(BULLETIN_INTL_LOCALE[locale] || "en", { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(date);
  } catch (_) {
    return date.toISOString().slice(0,16).replace("T"," ");
  }
}

function bulletinWarningLabel(data: BulletinImageData, copy: BulletinCopy): string {
  return copy.warningLabel ? copy.warningLabel(data) : data.warningLabel;
}
function bulletinWarningSummary(data: BulletinImageData, copy: BulletinCopy): string {
  return copy.warningSummary ? copy.warningSummary(data) : (data.bulletinBody || data.warningReason);
}

function localizeTyphoonName(name: string, locale: BulletinLocale): string {
  const raw = String(name || "").trim();
  if (["mainland","hongkong","macau","taiwan"].includes(locale)) return raw || "未命名颱風";
  const matched = TYPHOON_NAMING_TABLE.find((entry) => entry.chinese === raw || entry.english.toLowerCase() === raw.toLowerCase());
  if (matched) return matched.english;
  if (/^[\u3400-\u9fff]+$/.test(raw)) {
    if (locale === "japan") return "名称未設定";
    if (locale === "korea" || locale === "northkorea") return "이름 미정";
    if (locale === "vietnam") return "CHƯA ĐẶT TÊN";
    if (locale === "thailand") return "ยังไม่มีชื่อ";
    if (locale === "malaysia" || locale === "brunei") return "TANPA NAMA";
    if (locale === "indonesia") return "TANPA NAMA";
    if (locale === "cambodia") return "មិនទាន់មានឈ្មោះ";
    if (locale === "laos") return "ຍັງບໍ່ມີຊື່";
    return "UNNAMED";
  }
  return raw || "UNNAMED";
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of String(text || "").split(/\n/)) {
    if (!raw) { out.push(""); continue; }
    const latin = /\s/.test(raw) && !/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(raw);
    const units = latin ? raw.trim().split(/\s+/).map((w) => `${w} `) : Array.from(raw);
    let line = "";
    for (const unit of units) {
      const candidate = line + unit;
      if (line && ctx.measureText(candidate.trimEnd()).width > maxWidth) {
        out.push(line.trimEnd());
        line = unit;
      } else line = candidate;
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 99): number {
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function generateBulletinCanvas(data: BulletinImageData, type: BulletinImageType, ratio: BulletinRatio, quality: BulletinQuality): HTMLCanvasElement {
  const ratioDef = RATIOS.find((r) => r.id === ratio)!;
  const canvas = document.createElement("canvas");
  canvas.width = ratioDef.w * quality;
  canvas.height = ratioDef.h * quality;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(quality, quality);

  const W = ratioDef.w, H = ratioDef.h;
  const copy = getReportCopy(data.locale);
  const black = "#111111", dark = "#303030", gray = "#6a6a6a", pale = "#d7d7d7", white = "#ffffff";
  const base = Math.min(W,H);
  const pad = Math.round(base * 0.052);
  const contentW = W - pad * 2;
  const localArea = localizePlaceName(data.areaName, data.locale);
  const airportName = localizeAirportName(data);
  const transportName = copy.labels.transport;

  ctx.fillStyle = white;
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle = black;
  ctx.fillRect(0,0,W,Math.max(6,Math.round(H*.006)));

  let y = pad * .72;
  ctx.fillStyle = black;
  ctx.font = `700 ${Math.round(base*.018)}px ${copy.font}`;
  ctx.fillText(copy.brand, pad, y);
  ctx.textAlign = "right";
  ctx.fillStyle = gray;
  ctx.font = `500 ${Math.round(base*.014)}px ${copy.font}`;
  ctx.fillText(data.issuedAt, W-pad, y);
  ctx.textAlign = "left";

  y = pad * 1.42;
  ctx.fillStyle = black;
  ctx.font = `800 ${Math.round(base*(ratio === "16:9" ? .038 : .044))}px ${copy.font}`;
  y = drawWrapped(ctx, `${localArea} · ${copy.typeNames[type]}`, pad, y, contentW, Math.round(base*.050), 2) + Math.round(pad*.18);

  ctx.fillStyle = dark;
  ctx.font = `700 ${Math.round(base*.024)}px ${copy.font}`;
  const localWarning = bulletinWarningLabel(data, copy);
  const subHeadline = `${localWarning} · ${data.typhoonName}`;
  y = drawWrapped(ctx, subHeadline, pad, y, contentW, Math.round(base*.033), 2) + Math.round(pad*.30);

  ctx.strokeStyle = black;
  ctx.lineWidth = Math.max(1.5, base*.0018);
  ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(W-pad,y); ctx.stroke();
  y += Math.round(pad*.34);

  const cols = ratio === "16:9" ? 4 : 2;
  const rows = cols === 4 ? 1 : 2;
  const metricGap = Math.round(base*.018);
  const metricW = (contentW - metricGap*(cols-1))/cols;
  const metricH = Math.round(base*(ratio === "16:9" ? .095 : .105));
  const metricLabelPx = Math.round(base*.0135);
  const metricValuePx = Math.round(base*(ratio === "16:9" ? .023 : .027));
  const metrics: Array<[string,string,string]> = type === "traffic" ? [
    [copy.labels.airport, copy.trafficStatus[Math.min(4,data.airportLevel)], airportName],
    [copy.labels.transport, copy.transportStatus[Math.min(4,data.transportLevel)], transportName],
    [copy.labels.gust, `${data.gust.toFixed(1)} m/s`, copy.labels.observation],
    [copy.labels.waterDepth, `${data.waterDepthCm.toFixed(0)} cm`, copy.labels.currentConditions]
  ] : type === "emergency" ? [
    [copy.labels.preparedness, `${data.preparedness}%`, copy.labels.currentConditions],
    [copy.labels.waterDepth, `${data.waterDepthCm.toFixed(0)} cm`, copy.labels.currentConditions],
    [copy.labels.rain24h, `${data.rain24h.toFixed(0)} mm`, copy.labels.observation],
    [copy.labels.stormSurge, `${data.stormSurge.toFixed(2)} m`, copy.labels.observation]
  ] : [
    [copy.labels.sustainedWind, `${data.wind.toFixed(1)} m/s`, `${copy.labels.gust} ${data.gust.toFixed(1)} m/s`],
    [copy.labels.pressure, `${data.pressure.toFixed(1)} hPa`, copy.labels.observation],
    [copy.labels.hourlyRain, `${data.hourlyRain.toFixed(1)} mm/h`, `${copy.labels.rain6h} ${data.rain6h.toFixed(0)} mm`],
    [copy.labels.waterDepth, `${data.waterDepthCm.toFixed(0)} cm`, `${copy.labels.rain24h} ${data.rain24h.toFixed(0)} mm`]
  ];

  metrics.forEach((m,i)=>{
    const row=Math.floor(i/cols), col=i%cols;
    const x=pad+col*(metricW+metricGap), yy=y+row*(metricH+metricGap);
    // No colored cards: quiet typographic grid with a single shared baseline.
    if (col>0) { ctx.strokeStyle=pale; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x-metricGap/2,yy); ctx.lineTo(x-metricGap/2,yy+metricH); ctx.stroke(); }
    ctx.fillStyle=gray; ctx.font=`600 ${metricLabelPx}px ${copy.font}`; ctx.fillText(m[0],x,yy+metricLabelPx*1.2);
    ctx.fillStyle=black; ctx.font=`800 ${metricValuePx}px ${copy.font}`; ctx.fillText(m[1],x,yy+metricLabelPx*1.2+metricValuePx*1.18);
    ctx.fillStyle=gray; ctx.font=`500 ${metricLabelPx}px ${copy.font}`;
    const tail=wrapText(ctx,m[2],metricW)[0]||"";
    ctx.fillText(tail,x,yy+metricH-metricLabelPx*.35);
  });
  y += rows*(metricH+metricGap)+Math.round(pad*.10);
  ctx.strokeStyle=pale; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(W-pad,y); ctx.stroke();
  y += Math.round(pad*.42);

  let heading = copy.labels.impacts;
  let body = data.warningReason;
  let bullets = copy.generalGuide;
  if (type === "warning") {
    heading = localWarning;
    body = bulletinWarningSummary(data, copy);
    // Use source bullets only when they are already native to the selected official region.
    const nativeGuide = data.locale === "mainland" || data.locale === "philippines" || data.locale === "japan" || data.locale === "korea";
    bullets = nativeGuide && data.defenseGuide?.length ? data.defenseGuide : copy.generalGuide;
  } else if (type === "traffic") {
    heading = copy.typeNames.traffic;
    body = copy.trafficSummary(data, airportName, transportName);
    bullets = copy.generalGuide.slice(0,2);
  } else if (type === "emergency") {
    heading = copy.typeNames.emergency;
    body = copy.emergencySummary(data);
    bullets = copy.generalGuide;
  } else if (type === "weather") {
    heading = copy.typeNames.weather;
    body = copy.weatherSummary(data);
    bullets = [
      `${copy.labels.rain6h}: ${data.rain6h.toFixed(0)} mm · ${copy.labels.rain24h}: ${data.rain24h.toFixed(0)} mm`,
      `${copy.labels.stormSurge}: ${data.stormSurge.toFixed(2)} m · ${copy.labels.waterDepth}: ${data.waterDepthCm.toFixed(0)} cm`
    ];
  } else {
    heading = copy.typeNames.summary;
    body = copy.summaryText(data, airportName, transportName);
    bullets = copy.generalGuide;
  }

  ctx.fillStyle=black;
  ctx.font=`800 ${Math.round(base*.021)}px ${copy.font}`;
  ctx.fillText(heading,pad,y);
  y += Math.round(base*.033);
  ctx.fillStyle=dark;
  ctx.font=`500 ${Math.round(base*(ratio === "16:9" ? .015 : .0165))}px ${copy.font}`;
  const lineHeight=Math.round(base*(ratio === "16:9" ? .022 : .025));
  const footerY=H-pad*1.02;
  const textBottomLimit=footerY-pad*.8;
  const bodyMaxLines=ratio === "16:9" ? 4 : 7;
  y=drawWrapped(ctx,body,pad,y,contentW,lineHeight,bodyMaxLines)+Math.round(lineHeight*.42);

  ctx.font=`500 ${Math.round(base*(ratio === "16:9" ? .0145 : .0155))}px ${copy.font}`;
  const renderedBullets = bullets.slice(0, ratio === "16:9" ? 2 : 4);
  for (const b of renderedBullets) {
    if (y + lineHeight*2.2 > textBottomLimit) break;
    ctx.fillStyle=black;
    ctx.fillRect(pad,y-lineHeight*.55,Math.max(4,lineHeight*.16),Math.max(4,lineHeight*.16));
    ctx.fillStyle=dark;
    y=drawWrapped(ctx,b,pad+lineHeight*.50,y,contentW-lineHeight*.50,lineHeight,2)+Math.round(lineHeight*.32);
  }

  if (ratio !== "16:9") {
    const spareH = textBottomLimit - y;
    if (spareH > base * 0.15) {
      const gap = Math.round(base * 0.018);
      const panelY = y + Math.round(base * 0.006);
      const panelH = Math.max(Math.round(base * 0.14), spareH - Math.round(base * 0.01));
      const panelW = (contentW - gap) / 2;
      const drawPanel = (x: number, title: string, lines: string[]) => {
        ctx.strokeStyle = pale;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, panelY, panelW, panelH);
        ctx.fillStyle = black;
        ctx.font = `800 ${Math.round(base * 0.016)}px ${copy.font}`;
        ctx.fillText(title, x + 12, panelY + 20);
        ctx.fillStyle = dark;
        ctx.font = `500 ${Math.round(base * 0.0142)}px ${copy.font}`;
        let innerY = panelY + 42;
        for (const rawLine of lines) {
          innerY = drawWrapped(ctx, rawLine, x + 12, innerY, panelW - 24, Math.round(base * 0.020), 3) + 6;
          if (innerY > panelY + panelH - 14) break;
        }
      };
      const leftLines = [
        body,
        `${copy.labels.sustainedWind}: ${data.wind.toFixed(1)} m/s · ${copy.labels.pressure}: ${data.pressure.toFixed(1)} hPa`,
        `${copy.labels.hourlyRain}: ${data.hourlyRain.toFixed(1)} mm/h · ${copy.labels.waterDepth}: ${data.waterDepthCm.toFixed(0)} cm`
      ];
      const rightLines = [
        `${copy.labels.currentConditions}: ${data.typhoonName} · ${data.warningLabel}`,
        ...renderedBullets.map((b) => `• ${b}`),
        `${copy.labels.observation}: ${data.issuedAt}`
      ];
      drawPanel(pad, copy.labels.currentConditions, leftLines);
      drawPanel(pad + panelW + gap, heading, rightLines);
      y = panelY + panelH;
    }
  }

  ctx.strokeStyle=black; ctx.lineWidth=Math.max(1.5,base*.0018);
  ctx.beginPath(); ctx.moveTo(pad,footerY-pad*.30); ctx.lineTo(W-pad,footerY-pad*.30); ctx.stroke();
  ctx.fillStyle=black; ctx.font=`700 ${Math.round(base*.0125)}px ${copy.font}`;
  const agency = copy.authority || localizePlaceName(data.warningAuthority, data.locale);
  ctx.fillText(`${agency} · ${copy.generatedBy}`,pad,footerY);
  ctx.textAlign="right"; ctx.fillStyle=gray; ctx.font=`700 ${Math.round(base*.0118)}px ${copy.font}`;
  ctx.fillText(copy.simulationOnly,W-pad,footerY); ctx.textAlign="left";
  return canvas;
}

function StationBulletinImageMaker({ data, onClose }: BulletinMakerProps) {
  const [type, setType] = useState<BulletinImageType>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BULLETIN_MAKER_STORAGE_KEY) || "{}");
      return saved.type || "warning";
    } catch { return "warning"; }
  });
  const [ratio, setRatio] = useState<BulletinRatio>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BULLETIN_MAKER_STORAGE_KEY) || "{}");
      return saved.ratio || "4:5";
    } catch { return "4:5"; }
  });
  const [quality, setQuality] = useState<BulletinQuality>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BULLETIN_MAKER_STORAGE_KEY) || "{}");
      return saved.quality || 2;
    } catch { return 2; }
  });
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const ratioDef = useMemo(() => RATIOS.find((r) => r.id === ratio)!, [ratio]);
  useEffect(() => {
    try {
      localStorage.setItem(BULLETIN_MAKER_STORAGE_KEY, JSON.stringify({ type, ratio, quality }));
    } catch {}
  }, [type, ratio, quality]);

  const render = (download = false) => {
    const canvas = generateBulletinCanvas(data, type, ratio, quality);
    const url = canvas.toDataURL("image/png");
    setPreviewUrl(url);
    if (download) {
      const a = document.createElement("a");
      const typeLabel = TYPE_OPTIONS.find((x) => x.id === type)?.label || "公告图";
      a.download = `TyphoonSIM_${data.areaName}_${typeLabel}_${ratio}_${quality}x.png`.replace(/[\\/:*?"<>|]/g, "_");
      a.href = url;
      a.click();
    }
  };

  return <div className="fixed inset-0 z-[13000] bg-slate-950/98 flex flex-col">
    <div className="h-14 px-3 sm:px-5 border-b border-slate-800 flex items-center gap-3 shrink-0">
      <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-300"><ArrowLeft size={19}/></button>
      <div><div className="font-extrabold text-white text-sm">制作公告图</div><div className="text-[9px] text-slate-500">黑 / 白本地化公报版式 · 图片内容来自当前模拟态势</div></div>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto grid lg:grid-cols-[1fr_1.15fr] gap-5">
        <div className="space-y-5">
          <section><div className="text-xs font-bold text-slate-200 mb-2">1. 公告类型</div><div className="grid sm:grid-cols-2 gap-2">{TYPE_OPTIONS.map((o) => { const Icon=o.icon; return <button key={o.id} onClick={() => setType(o.id)} className={`text-left rounded-xl border p-3 ${type===o.id?"border-red-500/60 bg-red-500/10":"border-slate-800 bg-slate-900/60 hover:bg-slate-900"}`}><div className="flex items-center gap-2"><Icon size={17} className={type===o.id?"text-red-300":"text-slate-400"}/><span className="text-sm font-bold text-slate-100">{o.label}</span></div><div className="text-[10px] text-slate-500 mt-1">{o.desc}</div></button>})}</div></section>
          <section><div className="text-xs font-bold text-slate-200 mb-2">2. 图片比例</div><div className="grid grid-cols-2 gap-2">{RATIOS.map((o)=><button key={o.id} onClick={()=>setRatio(o.id)} className={`rounded-xl border p-3 text-left ${ratio===o.id?"border-red-500/60 bg-red-500/10":"border-slate-800 bg-slate-900/60"}`}><div className="text-sm font-bold text-slate-100">{o.label}</div><div className="text-[10px] text-slate-500">{o.desc}</div></button>)}</div></section>
          <section><div className="text-xs font-bold text-slate-200 mb-2">3. 清晰度</div><div className="grid grid-cols-3 gap-2">{QUALITY.map((o)=><button key={o.id} onClick={()=>setQuality(o.id)} className={`rounded-xl border p-3 text-center ${quality===o.id?"border-red-500/60 bg-red-500/10":"border-slate-800 bg-slate-900/60"}`}><div className="text-sm font-bold text-slate-100">{o.label}</div><div className="text-[9px] text-slate-500 mt-1">{o.desc}</div></button>)}</div><div className="text-[10px] text-slate-600 mt-2">输出尺寸：{ratioDef.w*quality} × {ratioDef.h*quality}px</div></section>
          <div className="grid grid-cols-2 gap-2"><button onClick={()=>render(false)} className="rounded-xl border border-slate-700 bg-slate-900 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800">生成预览</button><button onClick={()=>render(true)} className="rounded-xl bg-red-600 hover:bg-red-500 py-3 text-sm font-extrabold text-white flex items-center justify-center gap-2"><Download size={17}/>生成并保存</button></div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 min-h-[420px] p-3 flex items-center justify-center overflow-auto">
          {previewUrl ? <img src={previewUrl} alt="公告图预览" className="max-w-full max-h-[72vh] object-contain shadow-2xl"/> : <div className="text-center text-slate-600"><ImageIcon size={42} className="mx-auto mb-3 opacity-50"/><div className="text-sm font-semibold">尚未生成预览</div><div className="text-[10px] mt-1">选择参数后点击“生成预览”</div></div>}
        </div>
      </div>
    </div>
  </div>;
}

export default function StationEmergencyDetail({ station, typhoon, reading, historyData, startDate, adminArea, onClose }: Props) {
  const city = stationCityName(station.name, station.lat, station.lon);
  const cityDisplayName = stationCityDisplayName(city, station.lat, station.lon);
  const currentHour = typhoon.simHour || 0;
  const [activeSection, setActiveSection] = useState<"overview" | "warning" | "news">("overview");
  const [showBulletinMaker, setShowBulletinMaker] = useState(false);

  // Exact clicked-point observations stay on station.lat/lon. Public warning/airport/emergency
  // state is intentionally anchored to one representative coordinate per administrative district.
  const publicArea = useMemo<StationAdministrativeArea>(() => adminArea || ({
    city,
    district: `${cityDisplayName}全市`,
    province: "",
    country: "",
    key: `fallback|${cityDisplayName}`,
    centerLat: station.lat,
    centerLon: station.lon,
    displayName: cityDisplayName,
    source: "fallback"
  } as StationAdministrativeArea), [adminArea, city, cityDisplayName, station.lat, station.lon]);
  const publicStation = useMemo(() => ({
    name: publicArea.displayName,
    city: publicArea.city || city,
    district: publicArea.district,
    country: publicArea.country,
    areaKey: publicArea.key,
    areaDisplayName: publicArea.displayName,
    lat: publicArea.centerLat,
    lon: publicArea.centerLon
  }), [publicArea, city]);

  const pointImpacts = useMemo(() => buildForecastImpacts(typhoon, { name: city, lat: station.lat, lon: station.lon }, reading), [typhoon, station.id, station.lat, station.lon, city, reading]);
  const publicHistory = useMemo(() => buildDistrictPublicHistory(typhoon, publicStation), [typhoon, publicArea.key]);
  const publicReading = useMemo(() => buildDistrictRepresentativeReading(typhoon, publicStation, publicHistory), [typhoon, publicArea.key, publicHistory]);
  const impacts = useMemo(() => buildForecastImpacts(typhoon, publicStation, publicReading), [typhoon, publicArea.key, publicReading]);
  const primaryWarning = useMemo(() => buildPrimaryWarning(typhoon, publicStation, publicReading), [typhoon, publicArea.key, publicReading]);

  // Point-value branch: these are deliberately tied to the exact double-click position.
  const infrastructure = useMemo(() => getInfrastructureProfile(`${city}:${station.lat.toFixed(3)},${station.lon.toFixed(3)}`), [city, station.lat, station.lon]);
  const waterDepthCm = useMemo(() => estimateWaterloggingDepthCm(`${city}:${station.lat.toFixed(3)},${station.lon.toFixed(3)}`, reading, historyData, currentHour), [city, station.lat, station.lon, reading, historyData, currentHour]);
  const rain3h = useMemo(() => recentRain(historyData, currentHour, 3), [historyData, currentHour]);
  const rain6h = useMemo(() => recentRain(historyData, currentHour, 6), [historyData, currentHour]);
  const rain24h = useMemo(() => recentRain(historyData, currentHour, 24), [historyData, currentHour]);

  // Public-area branch: every click resolved to the same district receives the same values here.
  const publicInfrastructure = useMemo(() => getInfrastructureProfile(publicArea.key), [publicArea.key]);
  const publicWaterDepthCm = useMemo(() => estimateWaterloggingDepthCm(publicArea.key, publicReading, publicHistory, currentHour), [publicArea.key, publicReading, publicHistory, currentHour]);
  const publicRain6h = useMemo(() => recentRain(publicHistory, currentHour, 6), [publicHistory, currentHour]);
  const warnings = useMemo(() => buildCurrentWarnings(typhoon, publicStation, publicReading, publicWaterDepthCm, publicRain6h), [typhoon, publicArea.key, publicReading, publicWaterDepthCm, publicRain6h]);
  const airport = useMemo(() => getAirportStatus(publicArea.city || city, impacts, publicReading, publicArea.district), [publicArea.city, publicArea.district, city, impacts, publicReading]);
  const preparedness = useMemo(() => getPreparednessProgress(typhoon, primaryWarning, airport.level), [typhoon, primaryWarning, airport.level]);
  const news = useMemo(() => buildEmergencyNews(typhoon, publicStation, publicHistory, primaryWarning, airport, startDate), [typhoon, publicArea.key, publicHistory, primaryWarning, airport, startDate]);
  const warningBulletin = useMemo(() => buildOfficialStyleWarningBulletin(typhoon, publicStation, primaryWarning, startDate, "发布"), [typhoon, publicArea.key, primaryWarning, startDate]);
  const region = getWarningRegion(publicArea.city || city, publicArea.centerLat, publicArea.centerLon);
  const bulletinLocale = resolveBulletinLocale(region, publicArea.country, publicArea.city || city, publicArea.centerLat, publicArea.centerLon);

  const temperature = Math.max(8, Math.min(35, 29 - Math.abs(station.lat - 20) * 0.22 - Math.min(4, Number(reading?.precipitation || 0) / 18)));
  const humidity = Math.max(45, Math.min(100, 64 + Math.min(31, Number(reading?.precipitation || 0) * 0.7) + Math.min(8, rain6h / 25)));
  const visibility = Math.max(0.6, 18 - Number(reading?.precipitation || 0) * 0.23 - Number(reading?.windSpeed || 0) * 0.05);
  const floodLabel = waterDepthCm >= 50 ? "严重积水" : waterDepthCm >= 25 ? "明显积水" : waterDepthCm >= 10 ? "局地积水" : "排水基本正常";
  const closest = pointImpacts.reduce((a, b) => b.distanceKm < a.distanceKm ? b : a, pointImpacts[0]);
  const nextWind = pointImpacts.filter((x) => x.leadHour <= 24).reduce((m, x) => Math.max(m, x.wind), 0);

  const transportStatus = publicWaterDepthCm >= 45 || primaryWarning.severity >= 4
    ? { label: "道路/公交大范围管制", detail: "低洼道路、跨海通道及部分公共交通线路进入停运或封闭状态。", level: 4 }
    : publicWaterDepthCm >= 20 || primaryWarning.severity >= 3
      ? { label: "部分线路停运/绕行", detail: "易涝路段和高架、桥梁实施限速，公交地铁按风险区段调整运营。", level: 3 }
      : primaryWarning.severity >= 2 || Number(publicReading?.windSpeed || 0) >= 14
        ? { label: "交通限速与班次调整", detail: "重点路段加强巡查，公共交通预留停运和缩班方案。", level: 2 }
        : { label: "地面交通基本正常", detail: "暂未达到大范围交通管制阈值。", level: 0 };

  const responseStages = [
    { label: "预警研判", value: Math.min(100, preparedness + 14) },
    { label: "人员与物资前置", value: preparedness },
    { label: "交通与重点设施管控", value: Math.max(10, preparedness - (airport.level >= 2 ? 2 : 15)) },
    { label: "排涝与抢险准备", value: Math.max(8, preparedness - (publicRain6h >= 80 ? 0 : 18)) }
  ];

  const tabClass = (key: "overview" | "warning" | "news") => `px-4 py-2.5 rounded-lg text-xs font-bold transition-colors ${activeSection === key ? "bg-sky-500/15 text-sky-200 border border-sky-500/30" : "text-slate-400 border border-transparent hover:text-slate-200 hover:bg-slate-800/70"}`;

  const bulletinImageData = useMemo<BulletinImageData>(() => ({
    region,
    locale: bulletinLocale,
    countryName: publicArea.country,
    warningSeverity: primaryWarning.severity,
    areaName: publicArea.displayName,
    cityName: cityDisplayName,
    issuedAt: formatBulletinImageTime(bulletinLocale, startDate, currentHour),
    warningLabel: primaryWarning.label,
    warningAuthority: warningBulletin?.agencyLabel || primaryWarning.authority,
    warningReason: primaryWarning.reason,
    warningAction: primaryWarning.action,
    bulletinHeadline: warningBulletin?.headline,
    bulletinBody: warningBulletin?.body,
    defenseGuide: warningBulletin?.defenseGuide,
    stationLat: station.lat, stationLon: station.lon,
    wind: Number(reading?.windSpeed || 0),
    gust: Number(reading?.gustSpeed || reading?.windSpeed || 0),
    pressure: Number(reading?.pressure || 1013),
    hourlyRain: Number(reading?.precipitation || 0),
    rain6h, rain24h, waterDepthCm,
    stormSurge: Number(reading?.stormSurge || 0),
    airportName: airport.airport, airportStatus: airport.status, airportLevel: airport.level,
    transportLabel: transportStatus.label, transportLevel: transportStatus.level, transportDetail: transportStatus.detail,
    preparedness,
    typhoonName: localizeTyphoonName(String(typhoon.name || "未命名台风"), bulletinLocale),
    typhoonVmax: Number(typhoon.vmax || 0), typhoonPmin: Number(typhoon.pmin || 1010)
  }), [region, bulletinLocale, publicArea.country, publicArea.displayName, cityDisplayName, warningBulletin, primaryWarning, startDate, currentHour, station.lat, station.lon, reading, rain6h, rain24h, waterDepthCm, airport, transportStatus, preparedness, typhoon.name, typhoon.vmax, typhoon.pmin]);

  return (
    <div className="fixed inset-0 z-[12000] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-6xl h-[96dvh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><Siren className="text-amber-300" size={20}/><h2 className="font-extrabold text-white truncate">{cityDisplayName}气象与应急详情</h2></div>
            <div className="text-[10px] text-slate-500 mt-0.5">点位：{station.lat.toFixed(3)}°N {station.lon.toFixed(3)}°E · 公共状态：{publicArea.displayName} · {warningRegionLabel[region]}预警体系</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"><X size={20}/></button>
        </div>

        <div className="px-4 sm:px-6 pt-3 pb-2 border-b border-slate-800/80 bg-slate-900 sticky top-0 z-10">
          <div className="grid grid-cols-3 gap-2 max-w-xl">
            <button onClick={() => setActiveSection("overview")} className={tabClass("overview")}>实时概览</button>
            <button onClick={() => setActiveSection("warning")} className={tabClass("warning")}>预警与公共状态</button>
            <button onClick={() => setActiveSection("news")} className={tabClass("news")}>新闻与事件 <span className="ml-1 text-[10px] opacity-70">{news.length}</span></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-5">
            <button onClick={() => setActiveSection("warning")} className={`text-left rounded-xl border p-3 ${severityClass(primaryWarning.severity)}`}>
              <div className="text-[10px] opacity-70">当前主预警</div><div className="font-extrabold text-sm mt-1">{primaryWarning.label}</div><div className="text-[9px] opacity-60 mt-1">{publicArea.displayName}</div>
            </button>
            <div className={`rounded-xl border p-3 ${severityClass(airport.level)}`}><div className="text-[10px] opacity-70">机场运行</div><div className="font-extrabold text-sm mt-1">{airport.status}</div><div className="text-[9px] opacity-60 mt-1 truncate">{airport.airport}</div></div>
            <div className={`rounded-xl border p-3 ${publicWaterDepthCm >= 25 ? "border-orange-500/30 bg-orange-500/10 text-orange-100" : "border-sky-500/20 bg-sky-500/5 text-sky-100"}`}><div className="text-[10px] opacity-70">行政区典型积水</div><div className="font-extrabold text-sm mt-1">{publicWaterDepthCm.toFixed(0)} cm</div><div className="text-[9px] opacity-60 mt-1">近6h雨量 {publicRain6h.toFixed(0)} mm</div></div>
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-emerald-100"><div className="text-[10px] opacity-70">防灾准备</div><div className="font-extrabold text-sm mt-1">{preparedness}%</div><div className="h-1.5 rounded bg-slate-800 mt-2 overflow-hidden"><div className="h-full bg-emerald-400/80" style={{ width: `${preparedness}%` }}/></div></div>
          </div>

          {activeSection === "overview" && <div className="space-y-4">
            <section className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-3">
                <div><div className="text-sm font-bold text-white">双击点实时气象</div><div className="text-[10px] text-slate-500">以下数值全部来自双击位置，不使用行政区代表点</div></div>
                <div className="text-[10px] text-slate-500">最近预报中心 {Math.round(closest?.distanceKm || 0)} km · 未来24h局地风峰 {nextWind.toFixed(1)} m/s</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  [<Wind size={16}/>, "平均风", `${Number(reading?.windSpeed || 0).toFixed(1)} m/s`],
                  [<Activity size={16}/>, "阵风", `${Number(reading?.gustSpeed || reading?.windSpeed || 0).toFixed(1)} m/s`],
                  [<Gauge size={16}/>, "气压", `${Number(reading?.pressure || 1013).toFixed(1)} hPa`],
                  [<CloudRain size={16}/>, "小时降水", `${Number(reading?.precipitation || 0).toFixed(1)} mm/h`],
                  [<Droplets size={16}/>, "近6h降水", `${rain6h.toFixed(1)} mm`],
                  [<Thermometer size={16}/>, "气温估算", `${temperature.toFixed(1)} ℃`],
                  [<Droplets size={16}/>, "相对湿度", `${humidity.toFixed(0)} %`],
                  [<Eye size={16}/>, "能见度", `${visibility.toFixed(1)} km`]
                ].map(([icon, label, value], i) => <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><div className="flex items-center gap-1.5 text-slate-500 text-[10px]">{icon}{label}</div><div className="mt-1.5 font-bold text-sm text-slate-100">{value}</div></div>)}
              </div>
            </section>

            <section className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
                <div className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Waves size={17} className="text-cyan-300"/>点位水情与积水</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3"><div className="text-[10px] text-cyan-300">风暴增水</div><div className="text-xl font-bold mt-1">{Number(reading?.stormSurge || 0).toFixed(2)} m</div><div className="text-[9px] text-slate-500">不含天文潮</div></div>
                  <div className={`rounded-lg border p-3 ${waterDepthCm >= 25 ? "border-orange-500/30 bg-orange-500/5" : "border-sky-500/20 bg-sky-500/5"}`}><div className="text-[10px] text-sky-300">低洼点积水</div><div className="text-xl font-bold mt-1">{waterDepthCm.toFixed(0)} cm</div><div className="text-[9px] text-slate-500">{floodLabel}</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><div className="text-[10px] text-slate-500">累计降水</div><div className="text-sm font-bold mt-1">3h {rain3h.toFixed(0)} · 6h {rain6h.toFixed(0)} · 24h {rain24h.toFixed(0)} mm</div></div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><div className="text-[10px] text-slate-500">点位排水能力</div><div className="text-sm font-bold mt-1">{infrastructure.label}</div><div className="text-[9px] text-slate-500">约 {infrastructure.drainageMmPerHour.toFixed(0)} mm/h</div></div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
                <div className="text-sm font-bold text-white mb-3">行政区公共态势摘要</div>
                <div className={`rounded-lg border p-3 ${severityClass(transportStatus.level)}`}><div className="font-bold text-xs">{transportStatus.label}</div><div className="text-[10px] opacity-75 mt-1">{transportStatus.detail}</div></div>
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3"><div className="text-[10px] text-slate-500">基础设施韧性</div><div className="font-bold text-slate-200 mt-1">{Math.round(publicInfrastructure.index * 100)}/100 · {publicInfrastructure.label}</div><div className="text-[9px] text-slate-500 mt-1">该值用于{publicArea.displayName}的公共防灾评估。</div></div>
                <button onClick={() => setActiveSection("warning")} className="mt-3 w-full rounded-lg border border-sky-500/20 bg-sky-500/5 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/10">查看完整预警、机场与防灾状态</button>
              </div>
            </section>
          </div>}

          {activeSection === "warning" && <div className="space-y-4">
            <section className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
              <div className="mb-3"><div className="text-sm font-bold text-white flex items-center gap-2"><AlertTriangle size={17} className="text-amber-300"/>当前预警</div><div className="text-[10px] text-slate-500 mt-1">{publicArea.displayName}统一发布，按行政区代表点和未来预报路径研判</div></div>
              <div className="grid md:grid-cols-2 gap-2">{warnings.map((w) => <div key={w.id} className={`rounded-lg border p-3 ${severityClass(w.severity)}`}><div className="font-bold text-sm">{w.label}</div><div className="text-[10px] mt-1 opacity-80">{w.authority}{w.leadHours ? ` · 提前量≤${w.leadHours}h` : ""}</div><div className="text-xs mt-2 text-slate-200">{w.reason}</div><div className="text-[10px] mt-1.5 text-slate-400">建议：{w.action}</div><details className="mt-2 text-[9px] text-slate-500"><summary className="cursor-pointer">判据说明</summary><div className="mt-1 leading-relaxed">{w.sourceNote}</div></details></div>)}</div>
            </section>

            {warningBulletin && <section className="rounded-xl border border-red-500/25 bg-red-500/[0.04] overflow-hidden">
              <div className="px-4 py-3 border-b border-red-500/15 flex items-center justify-between gap-3"><div><div className="text-xs font-bold text-red-200">{warningBulletin.styleLabel}</div><div className="text-[9px] text-slate-500 mt-0.5">{warningBulletin.agencyLabel} · 结构参照公开业务产品，内容由模拟生成</div></div><div className="text-[9px] text-slate-500 shrink-0">{warningBulletin.issuedAt}</div></div>
              <div className="p-4"><div className="text-sm font-extrabold text-center text-slate-100 mb-3">{warningBulletin.headline}</div><p className="text-xs leading-6 text-slate-300 whitespace-pre-wrap">{warningBulletin.body}</p><div className="mt-4 border-t border-slate-800 pt-3"><div className="text-xs font-bold text-slate-200 mb-2">防御/行动建议</div><ol className="space-y-1.5 text-[11px] leading-relaxed text-slate-400 list-decimal list-inside">{warningBulletin.defenseGuide.map((g, i) => <li key={i}>{g}</li>)}</ol></div></div>
            </section>}

            <section className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4 space-y-3"><div className="text-sm font-bold text-white flex items-center gap-2"><Plane size={17} className="text-sky-300"/>机场与地面交通</div><div className={`rounded-lg border p-3 ${severityClass(airport.level)}`}><div className="font-bold text-sm">{airport.airport}</div><div className="text-xs mt-1">{airport.status}</div><div className="text-[10px] opacity-75 mt-1">{airport.detail}</div></div><div className={`rounded-lg border p-3 ${severityClass(transportStatus.level)}`}><div className="font-bold text-xs">{transportStatus.label}</div><div className="text-[10px] opacity-75 mt-1">{transportStatus.detail}</div></div></div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><div className="text-sm font-bold text-white flex items-center gap-2"><ShieldCheck size={17} className="text-emerald-300"/>防灾进度 <span className="ml-auto text-emerald-300">{preparedness}%</span></div><div className="mt-3 space-y-3">{responseStages.map((s) => <div key={s.label}><div className="flex justify-between text-[10px] text-slate-400"><span>{s.label}</span><span>{s.value}%</span></div><div className="h-1.5 mt-1 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-emerald-400/80" style={{ width: `${s.value}%` }}/></div></div>)}</div></div>
            </section>
          </div>}

          {activeSection === "news" && <section className="rounded-xl border border-slate-800 bg-slate-950/45 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><div className="text-sm font-bold text-white flex items-center gap-2"><Radio size={17} className="text-sky-300"/>行政区新闻与应急动态</div><div className="text-[10px] text-slate-500 mt-1">完整保留本次模拟期间已触发事件；同类事件依靠概率与冷却机制控制密度，不再限制总条数</div></div><div className="text-[10px] text-slate-500">共 {news.length} 条</div></div>
            <div className="divide-y divide-slate-800/70">{news.map((item) => <div key={item.id} className="p-4 flex gap-3"><div className={`mt-0.5 w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${severityClass(item.severity)}`}><NewsIcon item={item}/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-semibold text-slate-100">{item.title}</span><span className="text-[9px] text-slate-600">{formatEmergencyTime(startDate, item.simHour)}</span></div><p className="text-xs leading-relaxed text-slate-400 mt-1.5 whitespace-pre-wrap">{item.body}</p></div></div>)}{news.length === 0 && <div className="py-10 text-center text-xs text-slate-500">当前没有需要推送的行政区应急动态。</div>}</div>
          </section>}

          <section className="mt-5 rounded-xl border border-red-500/20 bg-white/[0.03] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div><div className="text-sm font-bold text-white flex items-center gap-2"><ImageIcon size={17} className="text-red-300"/>制作公告图</div><div className="text-[10px] text-slate-500 mt-1">将当前行政区预警、点位实况、机场交通和防灾信息排版成黑白本地语言公告图片。</div></div>
            <button onClick={() => setShowBulletinMaker(true)} className="shrink-0 rounded-lg bg-red-600 hover:bg-red-500 px-4 py-2.5 text-xs font-extrabold text-white">进入制作</button>
          </section>

          <div className="text-[9px] leading-relaxed text-slate-600 pt-4 pb-2">本页为 TyphoonSIM 仿真态势，不代表现实世界正在生效的官方预警、航班运行或灾情。点位气象值来自双击坐标；预警、机场/交通、防灾和新闻按行政区共享。各地预警正文仅参照公开业务产品结构，所有数值和事件均来自模拟。</div>
        </div>
      </div>
      {showBulletinMaker && <StationBulletinImageMaker data={bulletinImageData} onClose={() => setShowBulletinMaker(false)} />}
    </div>
  );
}
