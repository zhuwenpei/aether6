import type { Typhoon } from "../types";
import { TyphoonCategory } from "../types";

/** One diagnostic for the top capsule and status panel, based on the selected history snapshot. */
export function getStormStatus(storm: Typhoon, isPlaying: boolean, isReplay = false): string {
  if (storm.dissipated) return "已消散";
  if (storm.coldAirWarmCoreDestroyed || storm.category === TyphoonCategory.RL) return "残留低压云团";
  if (storm.category === TyphoonCategory.ET || (storm.extrTransition ?? 0) >= 0.80) return "温带气旋";
  if ((storm.extrTransition ?? 0) >= 0.72) return "温带化中";
  if ((storm.extrTransition ?? 0) >= 0.34) return "副热带气旋";
  const ewrc = storm.ewrcState;
  if (ewrc && !["none", "completed"].includes(ewrc)) return "眼墙置换中";
  if (storm.structureMode === "landfall_disintegrating") return "登陆后结构瓦解";
  if (["dry_leaf", "incense_coil"].includes(String(storm.structureMode))) return "干空气侵入";
  if (storm.structureMode === "dry_rebuilding_core") return "再湿化重组";
  // “中心结构修复中” is a recovery state, not a one-frame synonym for any structural scar.
  // Natural ventilation / brief convective asymmetry can nudge the generic damage flag around its
  // threshold for a few model hours; displaying that as a repair phase caused the top status chip
  // to flash on/off even though no actual rebuild sequence was underway. Only show repair while a
  // real recovery timer/intervention is active. Severe unrecovered damage gets its own stable label.
  const recoveryActive = !!storm.penaltyRecoveryActive ||
    (Number.isFinite(Number(storm.cloggedRecoveryHours)) && Number.isFinite(Number(storm.cloggedRecoveryTotalHours)) &&
      Number(storm.cloggedRecoveryTotalHours) > 0 && Number(storm.cloggedRecoveryHours) < Number(storm.cloggedRecoveryTotalHours));
  if (recoveryActive && (storm.isStructureDamaged || (storm.coreRebuildScar ?? 0) >= .18 || storm.isCoreDisrupted)) return "中心结构修复中";
  if (storm.isStructureDamaged && ((storm.coreRebuildScar ?? 0) >= .52 || storm.isCoreDisrupted)) return "中心结构受损";
  if (isReplay && !isPlaying) return "历史回放";
  if (!isPlaying) return "模拟已暂停";
  // intensityChange6h is a raw m/s delta from Engine, not a rounded public agency bin.
  const change6h = Number(storm.intensityChange6h ?? 0);
  const trend24h = Number(storm.intensityChange24h ?? 0);
  const history = storm.history || [];
  // During the first few hours, use the actual history interval so a 1h change
  // is not misleadingly classified as a complete 6h tendency.
  const historySpan = Math.max(0, Number(storm.simHour) - Number(history[0]?.simHour ?? storm.simHour));
  const rate6h = change6h / Math.max(1, Math.min(6, historySpan));
  const rate24h = trend24h / Math.max(1, Math.min(24, historySpan));
  const tendency = historySpan < .5 ? 0 : .75 * rate6h + .25 * rate24h;
  if (storm.rapidIntensifying && tendency >= .35) return "快速增强";
  if (tendency >= .85) return "快速增强";
  if (tendency >= .12) return "增强";
  if (tendency <= -.85) return "快速减弱";
  if (tendency <= -.12) return "减弱";
  return "维持强度";
}
