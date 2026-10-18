/**
 * Regional disaster-warning capability priors used by both the public-warning renderer and the
 * casualty/preparedness model. These are deliberately broad fictional simulation parameters,
 * not live assessments of any real agency. They represent uneven observation coverage,
 * classification/dissemination quality, evacuation capacity and response latency.
 */
export type DisasterCapabilityProfile = {
  key: string;
  label: string;
  warningReliability: number;
  classificationAccuracy: number;
  disseminationSpeed: number;
  responseCapacity: number;
  evacuationCapacity: number;
  infrastructureResilience: number;
  missedReportRate: number;
  underReportRate: number;
  falseAlarmRate: number;
  bulletinDelayHours: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const PROFILE = {
  japan: { key: "japan", label: "high-capacity", warningReliability: .97, classificationAccuracy: .96, disseminationSpeed: .97, responseCapacity: .93, evacuationCapacity: .89, infrastructureResilience: .87, missedReportRate: .012, underReportRate: .025, falseAlarmRate: .010, bulletinDelayHours: .35 },
  korea: { key: "korea", label: "high-capacity", warningReliability: .96, classificationAccuracy: .95, disseminationSpeed: .96, responseCapacity: .91, evacuationCapacity: .87, infrastructureResilience: .84, missedReportRate: .015, underReportRate: .030, falseAlarmRate: .012, bulletinDelayHours: .45 },
  hongkong: { key: "hongkong", label: "high-capacity", warningReliability: .97, classificationAccuracy: .96, disseminationSpeed: .97, responseCapacity: .92, evacuationCapacity: .88, infrastructureResilience: .86, missedReportRate: .010, underReportRate: .022, falseAlarmRate: .010, bulletinDelayHours: .30 },
  macau: { key: "macau", label: "high-capacity", warningReliability: .95, classificationAccuracy: .94, disseminationSpeed: .95, responseCapacity: .88, evacuationCapacity: .84, infrastructureResilience: .81, missedReportRate: .018, underReportRate: .035, falseAlarmRate: .014, bulletinDelayHours: .50 },
  taiwan: { key: "taiwan", label: "high-capacity", warningReliability: .95, classificationAccuracy: .94, disseminationSpeed: .95, responseCapacity: .89, evacuationCapacity: .84, infrastructureResilience: .79, missedReportRate: .020, underReportRate: .038, falseAlarmRate: .015, bulletinDelayHours: .55 },
  china: { key: "china", label: "high-capacity", warningReliability: .94, classificationAccuracy: .93, disseminationSpeed: .94, responseCapacity: .88, evacuationCapacity: .83, infrastructureResilience: .76, missedReportRate: .024, underReportRate: .045, falseAlarmRate: .018, bulletinDelayHours: .65 },
  philippines: { key: "philippines", label: "mixed-capacity", warningReliability: .78, classificationAccuracy: .76, disseminationSpeed: .70, responseCapacity: .61, evacuationCapacity: .56, infrastructureResilience: .47, missedReportRate: .085, underReportRate: .145, falseAlarmRate: .060, bulletinDelayHours: 2.8 },
  vietnam: { key: "vietnam", label: "mixed-capacity", warningReliability: .81, classificationAccuracy: .79, disseminationSpeed: .73, responseCapacity: .66, evacuationCapacity: .61, infrastructureResilience: .51, missedReportRate: .070, underReportRate: .120, falseAlarmRate: .050, bulletinDelayHours: 2.3 },
  thailand: { key: "thailand", label: "mixed-capacity", warningReliability: .79, classificationAccuracy: .77, disseminationSpeed: .72, responseCapacity: .65, evacuationCapacity: .61, infrastructureResilience: .56, missedReportRate: .075, underReportRate: .125, falseAlarmRate: .052, bulletinDelayHours: 2.4 },
  malaysia: { key: "malaysia", label: "moderate-high-capacity", warningReliability: .88, classificationAccuracy: .86, disseminationSpeed: .85, responseCapacity: .78, evacuationCapacity: .72, infrastructureResilience: .67, missedReportRate: .045, underReportRate: .075, falseAlarmRate: .030, bulletinDelayHours: 1.35 },
  indonesia: { key: "indonesia", label: "mixed-capacity", warningReliability: .73, classificationAccuracy: .72, disseminationSpeed: .64, responseCapacity: .56, evacuationCapacity: .51, infrastructureResilience: .45, missedReportRate: .110, underReportRate: .165, falseAlarmRate: .070, bulletinDelayHours: 3.5 },
  cambodiaLaos: { key: "cambodia-laos", label: "lower-capacity", warningReliability: .66, classificationAccuracy: .67, disseminationSpeed: .56, responseCapacity: .48, evacuationCapacity: .46, infrastructureResilience: .40, missedReportRate: .145, underReportRate: .205, falseAlarmRate: .085, bulletinDelayHours: 4.6 },
  northKorea: { key: "north-korea", label: "lower-capacity", warningReliability: .63, classificationAccuracy: .66, disseminationSpeed: .54, responseCapacity: .45, evacuationCapacity: .43, infrastructureResilience: .39, missedReportRate: .155, underReportRate: .215, falseAlarmRate: .080, bulletinDelayHours: 4.8 },
  generic: { key: "generic", label: "mixed-capacity", warningReliability: .74, classificationAccuracy: .74, disseminationSpeed: .67, responseCapacity: .59, evacuationCapacity: .56, infrastructureResilience: .58, missedReportRate: .095, underReportRate: .145, falseAlarmRate: .060, bulletinDelayHours: 3.0 }
} satisfies Record<string, DisasterCapabilityProfile>;

function capabilityFromCountryHint(countryHint?: string): DisasterCapabilityProfile | null {
  const c = String(countryHint || "").trim().toLowerCase();
  if (!c) return null;
  if (/香港|hong kong/.test(c)) return PROFILE.hongkong;
  if (/澳门|澳門|macao|macau/.test(c)) return PROFILE.macau;
  if (/台湾|台灣|taiwan/.test(c)) return PROFILE.taiwan;
  if (/日本|japan/.test(c)) return PROFILE.japan;
  if (/朝鲜|朝鮮|north korea|democratic people/.test(c)) return PROFILE.northKorea;
  if (/韩国|韓國|south korea|republic of korea/.test(c)) return PROFILE.korea;
  if (/菲律宾|菲律賓|philippines/.test(c)) return PROFILE.philippines;
  if (/越南|vietnam|viet nam/.test(c)) return PROFILE.vietnam;
  if (/泰国|泰國|thailand/.test(c)) return PROFILE.thailand;
  if (/马来西亚|馬來西亞|malaysia|文莱|汶萊|brunei/.test(c)) return PROFILE.malaysia;
  if (/印度尼西亚|印度尼西亞|印尼|indonesia/.test(c)) return PROFILE.indonesia;
  if (/柬埔寨|cambodia|老挝|老撾|laos|lao pdr/.test(c)) return PROFILE.cambodiaLaos;
  if (/中国|中國|china/.test(c)) return PROFILE.china;
  return null;
}

export function getDisasterCapabilityProfile(lat: number, lon: number, countryHint?: string): DisasterCapabilityProfile {
  // Prefer an explicit administrative/country hint whenever it is available. This avoids broad
  // coordinate boxes incorrectly assigning northern Vietnam to China or Cambodia/Laos to Thailand.
  const hinted = capabilityFromCountryHint(countryHint);
  if (hinted) return hinted;

  // Offline fallback: small jurisdictions and unambiguous regional boxes first.
  if (lat >= 22.15 && lat <= 22.58 && lon >= 113.82 && lon <= 114.45) return PROFILE.hongkong;
  if (lat >= 22.08 && lat <= 22.25 && lon >= 113.48 && lon <= 113.66) return PROFILE.macau;
  if (lat >= 21.3 && lat <= 25.7 && lon >= 119.0 && lon <= 122.7) return PROFILE.taiwan;
  if (lat >= 30.0 && lat <= 46.5 && lon >= 129.0 && lon <= 146.8) return PROFILE.japan;
  if (lat >= 37.6 && lat <= 43.2 && lon >= 124.0 && lon <= 131.5) return PROFILE.northKorea;
  if (lat >= 33.0 && lat <= 39.4 && lon >= 124.0 && lon <= 132.2) return PROFILE.korea;
  if (lat >= 4.0 && lat <= 22.3 && lon >= 116.0 && lon <= 127.8) return PROFILE.philippines;
  if (lat >= 8.0 && lat <= 23.6 && lon >= 102.0 && lon <= 109.1) return PROFILE.vietnam;
  if (lat >= 5.0 && lat <= 21.0 && lon >= 97.0 && lon <= 105.5) return PROFILE.thailand;
  if (lat >= 0.5 && lat <= 7.8 && lon >= 99.0 && lon <= 119.5) return PROFILE.malaysia;
  if (lat >= -11.5 && lat <= 6.5 && lon >= 95.0 && lon <= 141.5) return PROFILE.indonesia;
  if (lat >= 9.0 && lat <= 23.0 && lon >= 100.0 && lon <= 108.0) return PROFILE.cambodiaLaos;
  if (lat >= 18.0 && lat <= 46.0 && lon >= 105.0 && lon <= 124.8) return PROFILE.china;
  return PROFILE.generic;
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

export type WarningOperationalOutcome = {
  anomaly: "none" | "delayed" | "missed" | "underreported" | "false_alarm";
  reportedSeverity: number;
  issueDelayHours: number;
  reliability: number;
};

/**
 * Deterministic event-level warning imperfection. Keeping the seed fixed to storm + public area
 * prevents the displayed warning from randomly flickering every simulation frame.
 */
export function evaluateWarningOperationalOutcome(args: {
  profile: DisasterCapabilityProfile;
  eventKey: string;
  truthSeverity: number;
  nominalLeadHours?: number;
  closestThreatLeadHours?: number;
  closestThreatDistanceKm?: number;
}): WarningOperationalOutcome {
  const { profile, eventKey, truthSeverity } = args;
  const delayJitter = .65 + .75 * deterministic01(`${eventKey}:delay`);
  const issueDelayHours = Math.max(0, profile.bulletinDelayHours * delayJitter);
  const severityProtection = clamp01((truthSeverity - 1) / 4);

  if (truthSeverity <= 0) {
    const nearCyclone = (args.closestThreatDistanceKm ?? 9999) < 950;
    const falseAlarm = nearCyclone && deterministic01(`${eventKey}:false`) < profile.falseAlarmRate;
    return { anomaly: falseAlarm ? "false_alarm" : "none", reportedSeverity: falseAlarm ? 1 : 0, issueDelayHours, reliability: profile.warningReliability };
  }

  const nominalLead = Math.max(0, args.nominalLeadHours ?? 24);
  const closestLead = Math.max(0, args.closestThreatLeadHours ?? 0);
  // A slower dissemination system begins publishing closer to impact. Once the threat is already
  // inside the delayed horizon, the warning appears and remains stable.
  if (closestLead > Math.max(1.5, nominalLead - issueDelayHours)) {
    return { anomaly: "delayed", reportedSeverity: 0, issueDelayHours, reliability: profile.warningReliability };
  }

  const missChance = profile.missedReportRate * (1 - .72 * severityProtection);
  if (deterministic01(`${eventKey}:miss`) < missChance) {
    return { anomaly: "missed", reportedSeverity: 0, issueDelayHours, reliability: profile.warningReliability };
  }

  const underChance = profile.underReportRate * (1 - .48 * severityProtection) * (1.08 - .18 * profile.classificationAccuracy);
  if (deterministic01(`${eventKey}:under`) < underChance) {
    const severeExtra = truthSeverity >= 4 && deterministic01(`${eventKey}:under-depth`) > .82 ? 2 : 1;
    return { anomaly: "underreported", reportedSeverity: Math.max(1, truthSeverity - severeExtra), issueDelayHours, reliability: profile.warningReliability };
  }

  return { anomaly: "none", reportedSeverity: truthSeverity, issueDelayHours, reliability: profile.warningReliability };
}
