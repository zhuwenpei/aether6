const fs = require('fs');
const assert = require('assert');

const modal = fs.readFileSync('src/components/VideoExportModal.tsx', 'utf8');
const renderer = fs.readFileSync('src/utils/VideoRenderEngine.ts', 'utf8');

assert(modal.includes('replayStyle: "jma_best_track"'), 'JMA Best Track must use its own replay profile');
assert(modal.includes('replayStyle: "himawari8_observation"'), 'Himawari 8 must use its own replay profile');
assert(modal.includes('JMA Best Track 专用设置'), 'JMA special settings page missing');
assert(modal.includes('向日葵8号监测专用设置'), 'Himawari 8 special settings page missing');
assert(modal.includes('地图范围选择 / 缩放档位'), 'special settings must expose map range');
assert(modal.includes('动画时长 (2 - 30 秒)'), 'special settings page must retain duration output control');
assert(modal.includes('动画帧率 (1 - 60 FPS)'), 'special settings page must retain FPS output control');
assert(modal.includes('画质分辨率'), 'special settings page must retain resolution output control');
assert(modal.includes('视频编码格式 (HEVC / AVC)'), 'special settings page must retain codec output control');
assert(modal.includes('视频码率 (Bitrate)'), 'special settings page must retain bitrate output control');

const hourlyStart = renderer.indexOf('function buildHourlyReplayPolyline');
const hourlyEnd = renderer.indexOf('export function interpolateTyphoonState', hourlyStart);
const hourly = renderer.slice(hourlyStart, hourlyEnd);
assert(hourly.includes('finalIntegerHour'), 'hourly replay should advance on integer-hour vertices');
assert(!hourly.includes('currentSimHour > finalIntegerHour'), 'fractional current-hour tail must not be appended');
assert(renderer.includes('ctx.lineJoin = "miter"'), 'Himawari track must preserve polyline corners');
assert(renderer.includes('ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();'), 'Himawari path must use straight line segments');
assert(renderer.includes('isHimawariExtratropical'), 'ET state helper missing');
assert(renderer.includes('category = "温帯低気圧(ET)"'), 'ET panel label missing');
assert(renderer.includes('台風${stormNumber}号は温帯低気圧に変わりました'), 'ET transition message missing');
assert(renderer.includes('ET 温帯低気圧'), 'ET track legend missing');
assert(renderer.includes('ひまわり8号 観測'), 'Himawari 8 observation title missing');

console.log('Round 44 video profile regression: PASS');
