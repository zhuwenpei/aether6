/** Exact branch-local copy of the live simulator's EWRC / dry-air / shear /
 * RI/ERI/URI intervention transitions. No parent state or timers are touched.
 * Source of behavioural parity: App.handleApplyInfluence (Round160).
 */
import type {Typhoon} from '../types';
export type InterventionKind='ewrc'|'dry_air'|'shear'|'rapid_intensify';
export type InterventionNotice=(text:string,level:string)=>void;
export function applyForecastSandboxIntervention(
  ty:Typhoon,type:InterventionKind,option:string,notice:InterventionNotice=()=>{}
):Typhoon{
  const nextTy={...ty};
  const showToast=notice;
  const clearEwrcFailureConsequences = (nextTy: Typhoon) => {
    const terrainDamageExists = !!nextTy.passedTaiwanCentral || !!nextTy.passedLuzonMountains || (nextTy.maxLandElevationPassed || 0) > 500;
    const shearDryDamageExists = !!nextTy.forcedDryAir || (nextTy.forcedShear !== undefined && nextTy.forcedShear > 15) || (nextTy.dryAirCoreExposure || 0) > 0.28;
    if (nextTy.damageOrigin === "ewrc_failure" || (nextTy.damageOrigin === "mixed" && !terrainDamageExists && !shearDryDamageExists)) {
      nextTy.damageOrigin = "none";
      nextTy.coreRebuildScar = 0;
      nextTy.isStructureDamaged = false;
      nextTy.isCoreDisrupted = false;
      nextTy.structuralDamagePenaltyFactor = 1;
      nextTy.structuralDamageHours = 0;
      nextTy.isEyeClogged = false;
      nextTy.eyeObstruction = Math.min(nextTy.eyeObstruction ?? 0.20, 0.20);
      nextTy.eyeAsymmetry = Math.min(nextTy.eyeAsymmetry ?? 0.20, 0.24);
      nextTy.eyewallIntegrity = Math.max(nextTy.eyewallIntegrity ?? 0.50, 0.50);
      delete nextTy.cloggedRecoveryHours;
      delete nextTy.cloggedRecoveryTotalHours;
    } else if (nextTy.damageOrigin === "mixed") {
      nextTy.damageOrigin = terrainDamageExists && shearDryDamageExists ? "mixed" : terrainDamageExists ? "terrain" : "shear_dry";
      nextTy.coreRebuildScar = Math.min(nextTy.coreRebuildScar ?? 0, terrainDamageExists ? 0.48 : 0.40);
      nextTy.structuralDamagePenaltyFactor = Math.max(nextTy.structuralDamagePenaltyFactor ?? 1, 0.72);
    }
  };

          if (type === "ewrc") {
            if (option === "auto") {
              const anyEwrcActive = nextTy.ewrcState === "forming" || nextTy.ewrcState === "max_decay" ||
                nextTy.ewrcState === "recovering_success" || nextTy.ewrcState === "recovering_failure" ||
                nextTy.ewrcState === "penalty_failure" || nextTy.forcedEWRC === "auto";
              if (anyEwrcActive && !nextTy.manualEwrcOutcomeOverride) {
                delete nextTy.forcedEWRC;
                nextTy.ewrcState = "none";
                nextTy.ewrcProgress = 0;
                nextTy.ewrcIsFailure = false;
                nextTy.ewrcFailureMode = "none";
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                nextTy.ewrcCooldownHours = Math.max(nextTy.ewrcCooldownHours || 0, 48);
                clearEwrcFailureConsequences(nextTy);
                showToast("已停止本次自动眼墙置换。程序判定与该次置换产生的失败惩罚已取消。", "success");
              } else {
                // Start a normal replacement episode with no outcome lock. The engine performs the
                // environmental success/failure diagnosis; the user may still override it later.
                nextTy.forcedEWRC = "auto";
                delete nextTy.manualEwrcOutcomeOverride;
                nextTy.ewrcIsFailure = false;
                nextTy.ewrcState = "none";
                nextTy.ewrcCooldownHours = 0;
                nextTy.ewrcProgress = 0;
                nextTy.ewrcFailureMode = "none";
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                delete nextTy.cloggedRecoveryHours;
                delete nextTy.cloggedRecoveryTotalHours;
                showToast("已启动正常眼墙置换：本轮成败由程序根据海温、风切、干空气、陆地接触和冷水尾流自动判定。之后可用“成功/失败”按钮人工覆盖结果。", "info");
              }
            } else {
            const requestedOutcome = option as "success" | "failure";
            const isCycleRunning = nextTy.ewrcState === "forming" || nextTy.ewrcState === "max_decay";
            const isFailureEpisode = nextTy.ewrcState === "penalty_failure" || nextTy.ewrcState === "recovering_failure" || !!nextTy.ewrcIsFailure;
            const isSuccessRecovery = nextTy.ewrcState === "recovering_success";
            const currentCycleOutcome: "success" | "failure" | undefined = nextTy.manualEwrcOutcomeOverride
              ?? (isFailureEpisode && !isCycleRunning ? "failure" : isSuccessRecovery ? "success" : undefined);
            const isCurrentlyActive = nextTy.forcedEWRC === requestedOutcome || currentCycleOutcome === requestedOutcome;

            if (isCurrentlyActive) {
              const cancellingFailure = requestedOutcome === "failure" && isFailureEpisode;
              delete nextTy.forcedEWRC;
              delete nextTy.manualEwrcOutcomeOverride;
              nextTy.ewrcState = "none";
              nextTy.ewrcProgress = 0;
              nextTy.ewrcFailurePenaltyHours = 0;
              nextTy.ewrcPenaltyTotalHours = 0;
              nextTy.ewrcIsFailure = false;
              nextTy.ewrcFailureMode = "none";
              // A manual cancellation is an explicit user decision. Keep the automatic trigger
              // suppressed through the same intensity episode instead of letting the next 10-min
              // model step immediately start another EWRC.
              nextTy.ewrcCooldownHours = Math.max(nextTy.ewrcCooldownHours || 0, 96);

              if (cancellingFailure) {
                clearEwrcFailureConsequences(nextTy);
                showToast("已取消置换失败状态；由该次置换失败产生的中心结构损坏惩罚已同步撤销，真实地形/干空气/风切损伤仍保留。", "success");
              } else {
                // Cancelling a normal/successful in-progress replacement still requires an inertial
                // reorganization period because two eyewall circulations were physically present.
                const recoveryHours = Math.min(42, 18 + nextTy.vmax * 0.28);
                nextTy.cloggedRecoveryTotalHours = recoveryHours;
                nextTy.cloggedRecoveryHours = 0.0;
                showToast(`已中止眼墙置换干预，核心进入约 ${Math.round(recoveryHours)} 小时的渐进重组期。`, "success");
              }
            } else if (isCycleRunning) {
              // User choice is an episode-level outcome lock.  Automatic land/shear/SST/cold-wake
              // diagnostics may continue to affect intensity, but they cannot reverse this explicit
              // success/failure decision before the current replacement episode ends.
              nextTy.manualEwrcOutcomeOverride = requestedOutcome;
              nextTy.ewrcIsFailure = requestedOutcome === "failure";
              if (requestedOutcome === "success") {
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                nextTy.ewrcFailureMode = "none";
              }
              delete nextTy.forcedEWRC;
              showToast(`已锁定当前眼墙置换结果为：${requestedOutcome === "success" ? "成功接替" : "置换失败"}。在本轮置换结束前，程序自动判定不会覆盖该结果。`, requestedOutcome === "success" ? "success" : "warning");
            } else if (isFailureEpisode || isSuccessRecovery) {
              // Re-write the outcome of the current diagnosed episode rather than starting a new
              // replacement cycle.  This is the key precedence rule: the user's physical-state
              // decision wins over a model result that was diagnosed earlier at the same stage.
              nextTy.manualEwrcOutcomeOverride = requestedOutcome;
              delete nextTy.forcedEWRC;
              nextTy.ewrcProgress = 0;
              nextTy.ewrcCooldownHours = 0;

              if (requestedOutcome === "success") {
                const wasFailure = isFailureEpisode;
                clearEwrcFailureConsequences(nextTy);
                nextTy.ewrcIsFailure = false;
                nextTy.ewrcFailureMode = "none";
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.ewrcPenaltyTotalHours = 0;
                nextTy.ewrcState = "recovering_success";
                nextTy.ewrcRecoveryDuration = Math.max(8, Math.min(24, nextTy.ewrcRecoveryDuration ?? 12));
                // Do not fabricate a large intensity jump.  A modest positive recovery tendency is
                // enough to represent successful takeover; hostile real environment terms can still
                // offset it in the integrator.
                nextTy.ewrcExtraAdjust = Math.max(nextTy.ewrcExtraAdjust ?? 0, 0.10);
                if (wasFailure) nextTy.successfulEwrcCount = (nextTy.successfulEwrcCount || 0) + 1;
                showToast("已将当前置换结果人工改判为成功：失败惩罚和仅由失败造成的结构疤痕已撤销，随后按成功置换恢复阶段继续积分。程序不会在本轮中重新改判为失败。", "success");
              } else {
                nextTy.ewrcIsFailure = true;
                nextTy.ewrcState = "penalty_failure";
                nextTy.ewrcFailureMode = nextTy.ewrcFailureMode && nextTy.ewrcFailureMode !== "none" ? nextTy.ewrcFailureMode : "double_eyewall_decay";
                nextTy.ewrcPenaltyTotalHours = Math.max(12, nextTy.ewrcPenaltyTotalHours || Math.min(30, 14 + nextTy.vmax * 0.16));
                nextTy.ewrcFailurePenaltyHours = 0;
                nextTy.isStructureDamaged = true;
                nextTy.coreRebuildScar = Math.max(nextTy.coreRebuildScar ?? 0, 0.54);
                nextTy.damageOrigin = nextTy.damageOrigin === "none" || nextTy.damageOrigin === "ewrc_failure" ? "ewrc_failure" : "mixed";
                showToast("已将当前置换结果人工改判为失败：立即进入置换失败的渐进结构惩罚阶段，本轮程序不会再自动改回成功。", "warning");
              }
            } else {
              // No EWRC episode is active: schedule a new cycle and lock its eventual outcome.
              nextTy.forcedEWRC = requestedOutcome;
              nextTy.manualEwrcOutcomeOverride = requestedOutcome;
              nextTy.ewrcIsFailure = requestedOutcome === "failure";
              nextTy.ewrcState = "none";
              nextTy.ewrcCooldownHours = 0;
              nextTy.ewrcProgress = 0;
              nextTy.ewrcFailurePenaltyHours = 0;
              nextTy.ewrcPenaltyTotalHours = 0;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;
              showToast(`已设定眼墙置换结果：${requestedOutcome === "success" ? "成功接替" : "置换失败"}；该人工结果在本轮置换中具有最高优先级，强度变化仍按完整周期渐进演变。`, requestedOutcome === "success" ? "success" : "warning");
            }
            }
          } else if (type === "dry_air") {
            if (nextTy.forcedDryAir === option) {
              const wasCore = nextTy.forcedDryAir === "core";
              delete nextTy.forcedDryAir;
              delete nextTy.dryAirPenaltyHours;
              delete nextTy.dryAirPenaltyTotalHours;
              const recoveryHours = wasCore
                ? Math.min(42, 18 + nextTy.vmax * 0.28)
                : Math.min(24, 9 + nextTy.vmax * 0.12);
              nextTy.cloggedRecoveryTotalHours = recoveryHours;
              nextTy.cloggedRecoveryHours = 0.0;
              showToast(`已停止干空气注入，残余干空气与结构损伤将在约 ${Math.round(recoveryHours)} 小时内渐进恢复。`, "success");
            } else {
              nextTy.forcedDryAir = option as "core" | "periphery";
              nextTy.dryAirPenaltyHours = undefined; // Force recalculation in engine
              nextTy.dryAirPenaltyTotalHours = undefined;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;
              // Dry air terminates RI/ERI through the engine's gradual rollover instead of an instant cut.
              if (nextTy.rapidIntensifying || nextTy.forcedRapidIntensification) {
                nextTy.rapidEpisodeAbortRequested = true;
              }
              showToast(`已施加干空气影响：${option === "core" ? "干空气侵入核心" : "外围卷入干空气"}！自动 RI/ERI 将按环境恶化过程退出。`, "warning");
            }
          } else if (type === "shear") {
            const val = parseFloat(option);
            if (nextTy.forcedShear === val) {
              delete nextTy.forcedShear;
              delete nextTy.shearPenaltyHours;
              delete nextTy.shearPenaltyTotalHours;
              const severity = Math.max(0, Math.min(1, (val - 15) / 25));
              const recoveryHours = Math.min(40, 14 + severity * 14 + nextTy.vmax * 0.16);
              nextTy.cloggedRecoveryTotalHours = recoveryHours;
              nextTy.cloggedRecoveryHours = 0.0;
              showToast(`已停止强风切变干预，涡旋将在约 ${Math.round(recoveryHours)} 小时内逐步重新对齐。`, "success");
            } else {
              nextTy.forcedShear = val;
              nextTy.shearPenaltyHours = undefined; // Force recalculation in engine
              nextTy.shearPenaltyTotalHours = undefined;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;
              // Wind shear terminates RI/ERI through a severity-dependent smooth rollover.
              if (nextTy.rapidIntensifying || nextTy.forcedRapidIntensification) {
                nextTy.rapidEpisodeAbortRequested = true;
              }
              showToast(`已施加垂直风切变影响：${val} kt！自动 RI/ERI 将按风切强度平滑退出。`, "warning");
            }
          } else if (type === "rapid_intensify") {
            const mode = option === "uri" ? "uri" : option === "eri" ? "eri" : "ri";
            const etBurstBlocked = !!nextTy.coldAirWarmCoreDestroyed;
            if (etBurstBlocked) {
              nextTy.rapidIntensifying = false;
              delete nextTy.forcedRapidIntensification;
              delete nextTy.forcedRapidIntensificationMode;
              delete nextTy.rapidIntensificationMode;
              nextTy.rapidEpisodeAbortRequested = true;
              showToast("强冷空气已彻底摧毁暖心，闭合台风涡旋已崩解为残留低压云团，禁止任何重新增强。", "warning");
              return nextTy;
            }
            const sameModeActive = (nextTy.rapidIntensifying || nextTy.forcedRapidIntensification) &&
              (nextTy.forcedRapidIntensificationMode || nextTy.rapidIntensificationMode || "ri") === mode;

            if (sameModeActive) {
              // Manual stop is also gradual: the RI contribution rolls back to the
              // environment-controlled tendency instead of disappearing in one step.
              // If this episode came from playground auto-ERI, pause automatic retriggering;
              // otherwise the next physics step would simply switch ERI back on.
              nextTy.rapidEpisodeAbortRequested = true;
              if (nextTy.playgroundAutoERI) {
                nextTy.playgroundAutoERIPaused = true;
                nextTy.playgroundAutoERI = false;
              }
              // Convert the current episode back to a non-forced episode while it ramps out.
              // This prevents the manual-forcing initializer from clearing the abort request.
              delete nextTy.forcedRapidIntensification;
              delete nextTy.forcedRapidIntensificationMode;
              nextTy.rapidTriggerCooldownHours = Math.max(nextTy.rapidTriggerCooldownHours || 0, 30);
              if (nextTy.penaltyRecoveryActive) {
                nextTy.penaltyRecoveryActive = false;
                nextTy.penaltyRecoveryElapsedHours = 0;
                nextTy.penaltyRecoveryTotalHours = 0;
                nextTy.penaltyRecoveryDryAir = false;
                nextTy.penaltyRecoveryShear = false;
                nextTy.penaltyRecoveryTerrain = false;
                nextTy.penaltyRecoveryStage = undefined;
              }
              showToast(`已请求结束${mode === "uri" ? "超高速爆发 URI" : mode === "eri" ? "极端快速增强 ERI" : "快速增强 RI"}，增强率将平滑回落；自动再次触发已暂时阻断。`, "info");
            } else {
              // Do not erase environmental states. The menu already prevents starting in an
              // actively hostile setup, and any deterioration after onset will terminate the
              // episode through the engine's gradual abort mechanism.
              nextTy.playgroundAutoERIPaused = false;
              nextTy.forcedRapidIntensification = true;
              nextTy.forcedRapidIntensificationMode = mode;
              nextTy.rapidIntensificationMode = mode;
              nextTy.rapidIntensifying = true;
              nextTy.rapidEpisodeElapsedHours = 0;
              nextTy.rapidEpisodeDurationHours = undefined; // engine samples realistic duration/rate envelope
              nextTy.rapidEpisodeTarget24h = undefined;
              nextTy.rapidEpisodeStartRate = undefined;
              nextTy.rapidEpisodeLastRate = undefined;
              nextTy.rapidEpisodeExitHours = 0;
              nextTy.rapidEpisodeExitDuration = undefined;
              nextTy.rapidEpisodeAbortRequested = false;
              delete nextTy.cloggedRecoveryHours;
              delete nextTy.cloggedRecoveryTotalHours;

              const terrainHollowSeverity = Math.max(0, Math.min(1, nextTy.terrainHollowCoreMemory ?? 0));
              const damagedCore = !!nextTy.isStructureDamaged || !!nextTy.isCoreDisrupted ||
                (nextTy.coreRebuildScar || 0) >= 0.30 || terrainHollowSeverity >= 0.12;
              if (damagedCore) {
                const severity = Math.max(0, Math.min(1, Math.max(
                  nextTy.isCoreDisrupted ? 0.85 : 0,
                  1 - (nextTy.structuralDamagePenaltyFactor ?? 1),
                  nextTy.coreRebuildScar ?? 0,
                  terrainHollowSeverity
                )));
                nextTy.penaltyRecoveryActive = true;
                nextTy.penaltyRecoveryElapsedHours = 0;
                nextTy.penaltyRecoveryTotalHours = 7.5 + 4.5 * severity;
                nextTy.penaltyRecoveryTerrain = nextTy.damageOrigin === "terrain" || nextTy.damageOrigin === "mixed";
                nextTy.penaltyRecoveryDryAir = nextTy.damageOrigin === "shear_dry" || nextTy.damageOrigin === "mixed";
                nextTy.penaltyRecoveryShear = nextTy.damageOrigin === "shear_dry" || nextTy.damageOrigin === "mixed";
                nextTy.penaltyRecoveryStage = "purging";
                nextTy.convectiveBurstIndex = Math.max(nextTy.convectiveBurstIndex ?? 0, 0.82);
                nextTy.deepConvectiveCoverage = Math.max(nextTy.deepConvectiveCoverage ?? 0, 0.72);
                showToast(`中心重构爆发已启动：先触发强深对流重新包裹中心，随后约 ${nextTy.penaltyRecoveryTotalHours.toFixed(1)} 小时内重新闭合眼墙并开眼。`, "success");
              }
              if (!damagedCore) {
                showToast(mode === "uri"
                  ? "已开启超高速爆发 URI：前2小时平滑升至 2.28–2.37 m/s/h，持续25小时，结束后2小时平滑恢复。"
                  : mode === "eri"
                  ? "已开启极端快速增强 ERI：典型约 24–30 m/s / 24h，持续约 10–20h。"
                  : "已开启快速增强 RI：典型约 15–22 m/s / 24h，通常持续约 12–24h。", "success");
              }
            }
          }

  return nextTy;
}

/** Same reversible-penalty reset as the live simulator; real terrain scars persist. */
export function clearForecastSandboxPenalties(ty:Typhoon,notice:InterventionNotice=()=>{}):Typhoon{
  const nextTy={...ty};
        // “取消所有惩罚” resets reversible intervention / penalty memory. An already destroyed warm core
        // is a physical phase-state latch and is deliberately NOT restored by this convenience action.
        delete nextTy.forcedDryAir;
        delete nextTy.forcedShear;
        delete nextTy.forcedColdAirStrength;
        delete nextTy.forcedColdAirArrivalHour;
        delete nextTy.forcedColdAirScheduledHour;
        delete nextTy.coldAirExposureHours;
        delete nextTy.forcedColdWaterTemperatureC;
        delete nextTy.forcedColdWaterStartHour;
        delete nextTy.forcedColdWaterEndHour;
        delete nextTy.forcedColdWaterDurationHours;
        delete nextTy.forcedEWRC;
        delete nextTy.manualEwrcOutcomeOverride;
        delete nextTy.dryAirPenaltyHours;
        delete nextTy.dryAirPenaltyTotalHours;
        delete nextTy.shearPenaltyHours;
        delete nextTy.shearPenaltyTotalHours;
        delete nextTy.cloggedRecoveryHours;
        delete nextTy.cloggedRecoveryTotalHours;
        nextTy.ewrcIsFailure = false;
        nextTy.ewrcFailurePenaltyHours = 0;
        nextTy.ewrcPenaltyTotalHours = 0;
        nextTy.ewrcFailureMode = "none";
        if (["penalty_failure", "recovering_failure"].includes(nextTy.ewrcState || "none")) {
          nextTy.ewrcState = "none";
          nextTy.ewrcProgress = 0;
        }
        const persistentTerrainHollow = Math.max(0, Math.min(1, nextTy.terrainHollowCoreMemory ?? 0));
        nextTy.passedTaiwanCentral = persistentTerrainHollow >= 0.12 ? nextTy.passedTaiwanCentral : false;
        nextTy.passedLuzonMountains = persistentTerrainHollow >= 0.12 ? nextTy.passedLuzonMountains : false;
        nextTy.maxLandElevationPassed = persistentTerrainHollow >= 0.12 ? nextTy.maxLandElevationPassed : 0;
        nextTy.structuralDamageHours = persistentTerrainHollow >= 0.12 ? nextTy.structuralDamageHours : 0;
        nextTy.structuralDamagePenaltyFactor = 1;
        nextTy.isStructureDamaged = persistentTerrainHollow >= 0.12;
        nextTy.isCoreDisrupted = persistentTerrainHollow >= 0.34;
        nextTy.damageOrigin = persistentTerrainHollow >= 0.12 ? "terrain" : "none";
        nextTy.coreRebuildScar = persistentTerrainHollow >= 0.12
          ? Math.max(nextTy.coreRebuildScar ?? 0, 0.16 + 0.24 * persistentTerrainHollow)
          : 0;
        nextTy.terrainDamageMorphology = persistentTerrainHollow >= 0.12 ? "hollow_bands" : undefined;
        nextTy.isEyeClogged = false;
        if (persistentTerrainHollow >= 0.12) {
          // Cancelling an artificial penalty must not visually recreate a closed eyewall for one
          // frame before the physics step catches up. Preserve a ragged/broken architecture.
          nextTy.eyeObstruction = Math.max(nextTy.eyeObstruction ?? 0.24, 0.18);
          nextTy.eyeAsymmetry = Math.max(nextTy.eyeAsymmetry ?? 0.42, 0.42 + 0.24 * persistentTerrainHollow);
          nextTy.eyewallIntegrity = Math.min(nextTy.eyewallIntegrity ?? 0.30, 0.38);
          nextTy.eyePhase = "ragged";
          nextTy.eyeType = "broken";
          nextTy.structureMode = "terrain_hollow_bands";
        } else {
          nextTy.eyeObstruction = Math.min(nextTy.eyeObstruction ?? 0, 0.18);
          nextTy.eyeAsymmetry = Math.min(nextTy.eyeAsymmetry ?? 0, 0.20);
          nextTy.eyewallIntegrity = Math.max(nextTy.eyewallIntegrity ?? 0.45, 0.45);
        }
        nextTy.dryAirIntrusion = 0;
        nextTy.dryAirCoreExposure = 0;
        nextTy.dryAirVentilationIndex = 0;
        nextTy.dryAirCoreConnection = 0;
        nextTy.dryAirReMoistening = 0;
        nextTy.dryAirConvectiveArcBearingDeg = undefined;
        nextTy.eyewallColdPoolMemory = 0;
        nextTy.moistCoreProtection = Math.max(nextTy.moistCoreProtection ?? 0.55, 0.72);
        nextTy.dryErosionHours = 0;
        nextTy.dryRecoveryHours = 0;
        nextTy.drySlotBearingDeg = undefined;
        nextTy.rebuiltCoreDiameterKm = 0;
        nextTy.convectiveSuppression = 0;
        nextTy.postDryAirBurstSuppressionHours = 0;
        nextTy.structuralDisorganization = persistentTerrainHollow >= 0.12
          ? Math.max(nextTy.structuralDisorganization ?? 0, 0.46 + 0.34 * persistentTerrainHollow)
          : (nextTy.landed ? Math.min(nextTy.structuralDisorganization ?? 0, 0.18) : 0);
        nextTy.penaltyRecoveryActive = false;
        nextTy.penaltyRecoveryElapsedHours = 0;
        nextTy.penaltyRecoveryTotalHours = 0;
        nextTy.penaltyRecoveryDryAir = false;
        nextTy.penaltyRecoveryShear = false;
        nextTy.penaltyRecoveryTerrain = false;
        nextTy.penaltyRecoveryStage = undefined;
        notice(persistentTerrainHollow >= 0.12
          ? "已取消人为惩罚；高山穿越造成的中心空洞损伤属于真实结构破坏并已保留，需要点击爆发增强才能重构核心。"
          : "已取消全部人为惩罚及可恢复结构损伤记忆；后续只会按当前真实环境重新产生新的影响。", "success");

  return nextTy;
}
