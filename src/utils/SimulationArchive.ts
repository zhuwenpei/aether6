/**
 * Round144: portable, complete AETHER simulation checkpoint.
 * .aether files are UTF-8 JSON or gzip-compressed UTF-8 JSON, distinguished by
 * their magic bytes. Compression is a storage optimisation, not encryption.
 * The archive is deliberately versioned and does not execute imported data.
 */
import type { Typhoon, EventLog, ActiveLayers, SimulationConfig } from '../types';
import {PARAMETER_FIELDS} from '../simulation/RealisticParameterGeometry';

export const AETHER_ARCHIVE_FORMAT = 'aether.complete-simulation';
export const AETHER_ARCHIVE_SCHEMA = 1;
export const AETHER_ARCHIVE_EXTENSION = '.aether';
export const AETHER_READABLE_ARCHIVE_EXTENSION = '.aether.json';
const MAX_ARCHIVE_FILE_BYTES = 512 * 1024 * 1024;

/** localStorage has a small, synchronous per-origin quota. Never duplicate an
 * imported long-season JSON checkpoint into it on the main thread. Portable
 * export remains available, and smaller simulations keep browser recovery.
 */
export const skipOversizedLocalRecovery = (importBytes: number, historicalHours: number): boolean =>
  importBytes > 6 * 1024 * 1024 || historicalHours > 900;


export type SimulationArchiveData = {
  typhoons: Typhoon[];
  eventLogs: EventLog[];
  config: SimulationConfig;
  layers: ActiveLayers;
  currentHour: number;
  maxHour: number;
  totalSimMinutes: number;
  startDate: string;
  seasonEnded: boolean;
  speed: number;
  prngState: number;
  timelineCollapsed: boolean;
  genesisPos: { lat: number; lon: number };
  /** Only simulator/product preferences. No acceptance flags or private browser state. */
  productPreferences?: Record<string, string>;
};

export type SimulationArchive = {
  format: typeof AETHER_ARCHIVE_FORMAT;
  schemaVersion: number;
  applicationVersion: string;
  exportedAt: string;
  data: SimulationArchiveData;
};

const isRecord = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`无效的 AETHER 存档：${message}`);
}

/**
 * Corrects historical issue snapshots contaminated by a *live* pre-simulation reference.
 * Only history nodes are modified; the actual storm history and physical state survive.
 * Export uses a shallow copy and never mutates the user's active simulation.
 */
export function sanitizePreSimulationReferences<T extends { id:string; history: any[]; preSimulationReference?: any }>(storms: T[]): {typhoons:T[]; cleaned:number} {
  let cleaned=0;
  const typhoons=storms.map(storm=>{
    if(!isRecord(storm)||!Array.isArray(storm.history)) return storm;
    const history=storm.history.map(h=>({...h}));
    const issueByHour=new Map<number,any>();
    for(const h of history){
      const ref=h.preSimulationReference;
      if(ref===undefined) continue;
      delete h.preSimulationReference;
      cleaned++;
      if(isRecord(ref) && ref.stormId===storm.id && finite(ref.issueHour) &&
        Number.isInteger(ref.completedLeadHour) && ref.completedLeadHour>=1 &&
        Array.isArray(ref.fixes) && ref.fixes.length>=2 && ref.fixes.length<=10000 &&
        finite(ref.authority) && ref.version===1 && ref.authority>=0 && ref.authority<=1 &&
        ref.fixes[0]?.leadHour===0 &&
        Math.abs(ref.fixes[ref.fixes.length-1]?.leadHour-ref.completedLeadHour)<1e-5 &&
        ref.fixes.every((fix:any,i:number)=>isRecord(fix) && finite(fix.leadHour) &&
          (i===0 || fix.leadHour>ref.fixes[i-1].leadHour) &&
          [fix.lat,fix.lon,fix.vmax,fix.pmin,fix.speed,fix.rmw].every(finite) &&
          [fix.r7,fix.r10,fix.r12].every((r:any)=>isRecord(r) && [r.ne,r.se,r.sw,r.nw].every(finite)))){
        issueByHour.set(ref.issueHour, ref);
      } else {
        // Never silently suppress a corrupted or malicious reference: retain it
        // and let validateSimulationArchiveData emit its Chinese error.
        h.preSimulationReference=ref;
        cleaned--;
      }
    }
    for (const h of history) {
      const ref=issueByHour.get(h.simHour);
      if (ref && !h.preSimulationReference) {h.preSimulationReference=ref;cleaned--;}
    }
    let live=storm.preSimulationReference;
    const last=history.at(-1)?.simHour;
    if (isRecord(live) && finite(live.issueHour) && finite(last) && live.issueHour>last+1e-5){live=undefined;cleaned++;}
    return {...storm,history,preSimulationReference:live};
  });
  return {typhoons,cleaned};
}

/** One canonical payload verifier is used both before export and before import. */
export function validateSimulationArchiveData(value: unknown): SimulationArchiveData {
  assert(isRecord(value), '缺少模拟数据。');
  assert(Array.isArray(value.typhoons) && value.typhoons.length <= 10000, '台风列表不合法。');
  const ids = new Set<string>();
  for (const ty of value.typhoons) {
    assert(isRecord(ty) && typeof ty.id === 'string' && ty.id.length > 0 && !ids.has(ty.id), '台风标识无效或重复。');
    ids.add(ty.id);
    assert(typeof ty.name === 'string' && finite(ty.lat) && finite(ty.lon) && finite(ty.vmax), '台风状态缺失。');
    assert(Array.isArray(ty.history), '台风历史记录缺失。');
    // Optional Round185 edit provenance; old archives do not contain these fields.
    if(ty.historyRevision!==undefined)
      assert(Number.isSafeInteger(ty.historyRevision)&&ty.historyRevision>=0&&ty.historyRevision<=1000000000,
        '真实化历史版本号无效。');
    if(ty.realisticMotion!==undefined){
      const motion=ty.realisticMotion;
      assert(isRecord(motion)&&[1,2].includes(motion.version as number)&&typeof motion.seed==='string'&&
        motion.seed.length>0&&motion.seed.length<=256&&['low','mid','high'].includes(motion.strength as string)&&
        Array.isArray(motion.original)&&motion.original.length<=ty.history.length&&
        motion.original.length>=(motion.version===2?7:25)&&motion.original.length<=30000,
        '参数真实化撤销记录无效（版本、随机种子或历史长度不匹配）。');
      for(let index=0;index<motion.original.length;index++){
        const fix=motion.original[index],current=ty.history[index];
        assert(isRecord(fix)&&[fix.simHour,fix.lat,fix.lon].every(finite)&&
          Math.abs(fix.simHour-current.simHour)<1e-6&&Math.abs(fix.lat)<=90&&Math.abs(fix.lon)<=360,
          '参数真实化撤销记录包含非法坐标或时间轴。');
        if(motion.version===1){
          assert(finite(fix.speed)&&finite(fix.direction)&&fix.speed>=0&&fix.speed<=300&&fix.direction>=0&&fix.direction<360,
            '旧版真实化撤销记录包含非法移速或移向。');
        }else{
          assert(isRecord(fix.values)&&isRecord(fix.radii)&&Object.keys(fix.values).length<=50&&
            Object.keys(fix.radii).length<=3,'参数真实化撤销记录中的参数格式无效。');
          for(const [key,value] of Object.entries(fix.values))assert((PARAMETER_FIELDS as readonly string[]).includes(key)&&finite(value)&&Math.abs(value as number)<=1000000,
            '参数真实化撤销记录包含非法数值参数。');
          for(const [radius,quadrants] of Object.entries(fix.radii)){
            assert(['r7','r10','r12'].includes(radius)&&isRecord(quadrants),
              '参数真实化撤销记录包含非法风圈。');
            for(const [q,r] of Object.entries(quadrants))assert(['ne','se','sw','nw'].includes(q)&&finite(r)&&r>=0&&r<=5000,
              '参数真实化撤销记录包含非法风圈半径。');
          }
        }
      }
    }
    let lastHour = -Infinity;
    for (const h of ty.history) {
      assert(isRecord(h) && finite(h.simHour) && h.simHour >= 0 && h.simHour >= lastHour, '历史时间轴顺序错误。');
      assert(finite(h.lat) && finite(h.lon) && finite(h.vmax), '历史气象参数缺失。');
      if (h.preSimulationReferenceCleared !== undefined) {
        assert(typeof h.preSimulationReferenceCleared === "boolean", "预模拟撤销标记无效。");
      }
      if (h.preSimulationReference !== undefined) {
        const ref=h.preSimulationReference;
        assert(isRecord(ref) && ref.version===1 && ref.stormId===ty.id &&
          finite(ref.issueHour) && Math.abs(ref.issueHour-h.simHour)<1e-5 &&
          finite(ref.authority) && ref.authority>=0 && ref.authority<=1 &&
          finite(ref.completedLeadHour) && ref.completedLeadHour>=1 &&
          Array.isArray(ref.fixes) && ref.fixes.length>=2 && ref.fixes.length<=10000,
          '预模拟预报的起报时刻或数据结构无效。');
        assert(ref.origin===undefined || ref.origin==='main-history', '预报参考来源标识无效。');
        let lastLead=-Infinity;
        for (const fix of ref.fixes) {
          assert(isRecord(fix) && finite(fix.leadHour) && fix.leadHour>lastLead &&
            fix.leadHour>=0 && fix.leadHour<=ref.completedLeadHour &&
            [fix.lat,fix.lon,fix.vmax,fix.pmin,fix.speed,fix.rmw].every(finite) &&
            [fix.r7,fix.r10,fix.r12].every((r:unknown)=>isRecord(r) &&
              [r.ne,r.se,r.sw,r.nw].every(finite)),
            '预模拟预报包含损坏的历史节点或风圈。');
          lastLead=fix.leadHour;
        }
        assert(ref.fixes[0].leadHour===0 &&
          Math.abs(lastLead-ref.completedLeadHour)<1e-5,
          '预模拟预报时间轴无效。');
      }
      lastHour = h.simHour;
    }
  }
  assert(Array.isArray(value.eventLogs), '日志数据缺失。');
  for (const event of value.eventLogs) {
    assert(isRecord(event) && typeof event.id === 'string' &&
      finite(event.simHour) && typeof event.message === 'string' &&
      ['info', 'success', 'warning', 'danger'].includes(event.type) &&
      (typeof event.time === 'string' || event.time instanceof Date) &&
      Number.isFinite(new Date(event.time).getTime()), '日志记录无效。');
  }
  assert(isRecord(value.config) && typeof value.config.seed === 'string', '物理配置缺失。');
  if(value.config.realisticMotionEnabled!==undefined)
    assert(typeof value.config.realisticMotionEnabled==='boolean','历史兼容开关必须为布尔值。');
  assert(isRecord(value.layers), '地图图层配置缺失。');
  assert(finite(value.currentHour) && finite(value.maxHour) && value.currentHour >= 0 &&
    value.maxHour >= value.currentHour && value.maxHour <= 1_000_000, '时间轴数据不合法。');
  assert(finite(value.totalSimMinutes) && value.totalSimMinutes >= 0, '物理积分时间不合法。');
  assert(typeof value.startDate === 'string' && Number.isFinite(Date.parse(value.startDate)), '模拟开始日期无效。');
  assert(typeof value.seasonEnded === 'boolean', '风季状态缺失。');
  assert(finite(value.speed) && value.speed > 0 && value.speed <= 100000, '模拟速度无效。');
  assert(Number.isSafeInteger(value.prngState) && value.prngState >= 0, '随机数生成器状态无效。');
  assert(typeof value.timelineCollapsed === 'boolean', '时间轴界面状态缺失。');
  assert(isRecord(value.genesisPos) && finite(value.genesisPos.lat) && finite(value.genesisPos.lon) &&
    Math.abs(value.genesisPos.lat) <= 90 && Math.abs(value.genesisPos.lon) <= 360, '台风生成点无效。');
  if (value.productPreferences !== undefined) {
    assert(isRecord(value.productPreferences), '产品参数无效。');
    for (const [key, item] of Object.entries(value.productPreferences)) {
      assert(isAllowedProductPreference(key) && typeof item === 'string' && item.length <= 200000, '产品参数包含不支持的字段。');
    }
  }
  return value as SimulationArchiveData;
}

const PRODUCT_PREF_PREFIXES = ['forecast_', 'report_', 'station_', 'typhoon_chart_maker_', 'typhoon_ranking_', 'typhoon_video_'];
export const isAllowedProductPreference = (key: string): boolean =>
  PRODUCT_PREF_PREFIXES.some(prefix => key.startsWith(prefix));

export function captureProductPreferences(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !isAllowedProductPreference(key)) continue;
    const value = storage.getItem(key);
    if (value !== null && value.length <= 200000) result[key] = value;
  }
  return result;
}

export function makeSimulationArchive(data: SimulationArchiveData, now = new Date()): SimulationArchive {
  // Round178 invariant: never silently erase duplicate or malformed issue nodes
  // supplied for export. Ingestion is the one place where legacy archives are
  // repaired; ongoing simulation copies are fixed at their source.
  validateSimulationArchiveData(data);
  return {
    format: AETHER_ARCHIVE_FORMAT,
    schemaVersion: AETHER_ARCHIVE_SCHEMA,
    applicationVersion: '6.0.48',
    exportedAt: now.toISOString(),
    data: validateSimulationArchiveData({ ...data, typhoons:sanitizePreSimulationReferences(data.typhoons).typhoons })
  };
}

export function parseSimulationArchive(text: string): SimulationArchive {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('存档不是有效的 AETHER 数据文件，或文件已损坏。'); }
  assert(isRecord(parsed) && parsed.format === AETHER_ARCHIVE_FORMAT, '文件格式标识不匹配。');
  assert(parsed.schemaVersion === AETHER_ARCHIVE_SCHEMA, `文件版本不兼容（当前支持 v${AETHER_ARCHIVE_SCHEMA}）。`);
  assert(typeof parsed.applicationVersion === 'string' && typeof parsed.exportedAt === 'string', '缺少文件版本信息。');
  // Imported files still undergo strict canonical checks after repairing misplaced issue nodes.
  const candidate = isRecord(parsed.data) && Array.isArray(parsed.data.typhoons)
    ? {...parsed.data, typhoons:sanitizePreSimulationReferences(parsed.data.typhoons).typhoons} : parsed.data;
  const data = validateSimulationArchiveData(candidate);
  // The event UI expects actual Dates; JSON encodes Date as ISO strings.
  return { ...parsed, data: {
    ...data,
    eventLogs: data.eventLogs.map(event => ({ ...event, time: new Date(event.time) }))
  } } as SimulationArchive;
}

/** Human-readable explanatory metadata is outside the canonical data payload.
 * A modified file remains exactly the same validated, importable save format.
 */
export function makeAiReadableSimulationArchive(data: SimulationArchiveData): SimulationArchive & {
  aiEditingGuide: Record<string, unknown>;
} {
  const archive = makeSimulationArchive(data);
  const aiEditingGuide = {
      purpose: 'AETHER 台风模拟完整可编辑存档；UTF-8 JSON，允许用文本编辑器或 AI 直接读取修改，再导回模拟器。',
      format: archive.format,
      schemaVersion: archive.schemaVersion,
      editing: [
        '先阅读 data.config（物理配置）、data.typhoons（台风与全部历史）、data.currentHour / maxHour（时间轴）。',
        'data.typhoons[n].history[h].preSimulationReference（若有）是从该起报小时开始、直到更晚的参考替代或预演时效结束的预模拟参考，包含逐小时风速、气压、位置、移速、方向、风圈；可单独编辑，但必须保持 issueHour 与当前历史时刻一致。',
        'data.typhoons[n].history 是依照 simHour 从小到大排序的完整历史快照；修改后必须保持时间不倒序，且每条记录至少具备 lat/lon/vmax。',
        'data.typhoons[n] 中当前状态与 history 中最新状态不是同一对象；若修改当前台风的物理强度或位置，应一并检查对应时间的历史快照。',
        '修改 data.config.seed 或 data.prngState 可能改变续跑的随机事件；若要保持后续物理轨迹可复现，尽量不动这两个字段。',
        '编辑完成后必须保留 format、schemaVersion、applicationVersion、exportedAt、data 等必需字段，并保留有效的 JSON 语法。',
        'data.eventLogs[n].time 采用 ISO 8601 日期字符串，data.startDate 也采用 ISO 8601；所有经纬度字段单位为度，风速 vmax 为 m/s。',
        '本文件中 aiEditingGuide 只为阅读提供说明，不参与物理积分和导入状态恢复。'
      ],
      sections: {
        'data.typhoons': '逐台风当前状态、全部历史快照、气象站与其他物理内部状态。',
        'data.eventLogs': '风季事件日志。',
        'data.config': '物理参数、人工路径和模型设置；优先保持原字段完整。',
        'data.layers': '地图显示图层。',
        'data.currentHour': '当前观看/运行时刻，单位模拟小时。',
        'data.maxHour': '历史已运行到的最远时刻，单位模拟小时。',
        'data.totalSimMinutes': '物理引擎积分总分钟数。',
        'data.startDate': '模拟风季的绝对起始日期。',
        'data.prngState': '随机数生成器准确内部状态。',
        'data.productPreferences': '气象产品及报告的用户设置。'
      },
      contents: {
        stormCount: data.typhoons.length,
        storms: data.typhoons.map(ty => ({ id: ty.id, name: ty.name, historySnapshots: ty.history.length })),
        currentHour: data.currentHour,
        maxHour: data.maxHour
      }
    };
  // Keep the human-readable summary BEFORE the potentially enormous history.
  // A new AI conversation sees the editing contract and storm index first.
  return {
    format: archive.format,
    schemaVersion: archive.schemaVersion,
    applicationVersion: archive.applicationVersion,
    exportedAt: archive.exportedAt,
    aiEditingGuide,
    data: archive.data
  };
}

export async function createSimulationArchiveBlob(data: SimulationArchiveData, mode: 'compressed' | 'readable' = 'compressed'): Promise<Blob> {
  if (mode === 'readable') {
    // Pretty JSON is intentionally NOT gzipped: new conversations can inspect
    // and safely edit it without binary tools. The compact backup remains available.
    const json = JSON.stringify(makeAiReadableSimulationArchive(data), null, 2) + '\n';
    return new Blob([json], { type: 'application/json;charset=utf-8' });
  }
  const json = JSON.stringify(makeSimulationArchive(data));
  const plain = new Blob([json], { type: 'application/json' });
  if (typeof CompressionStream !== 'undefined') {
    try {
      return await new Response(plain.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    } catch (err) {
      console.warn('AETHER archive compression unavailable, using JSON:', err);
    }
  }
  return plain;
}

export async function readSimulationArchiveFile(file: Blob): Promise<SimulationArchive> {
  if (file.size === 0 || file.size > MAX_ARCHIVE_FILE_BYTES) throw new Error('存档为空或体积超过 512MB 限制。');
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzip = magic[0] === 0x1f && magic[1] === 0x8b;
  let text: string;
  if (gzip) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持压缩存档，请使用支持 gzip 的现代浏览器。');
    try { text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
    catch { throw new Error('存档解压失败，文件可能不完整或已损坏。'); }
  } else {
    text = await file.text();
  }
  return parseSimulationArchive(text);
}
