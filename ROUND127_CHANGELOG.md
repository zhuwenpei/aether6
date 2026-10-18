# ROUND127_CHANGELOG

## 鼠标音替换为用户提供的实录双触发音效

- 使用用户提供的 `universfield-computer-mouse-click-352734.mp3` 替换旧的程序合成鼠标微动音。
- 音频中检测到两次主要瞬态约位于：
  - 第一声：`0.161 s`
  - 第二声：`0.249 s`
- 自动裁切为：
  - `src/assets/audio/mouse-press.wav`：按下声，约 80 ms；
  - `src/assets/audio/mouse-release.wav`：松开声，约 92 ms。
- 对裁切片段加入极短淡入/淡出，避免切点爆音；同时做瞬态软限幅，保留机械微动的脆响感。

## 按下 / 松开真实分离触发

- 鼠标音与麻将音现在使用相同的手势机制：
  - `pointerdown` → 第一声；
  - `pointerup` → 第二声。
- 全局 pointer 状态会记住按下时采用的是 mouse 还是 mahjong，避免按住期间修改设置后出现按下/松开音效错配。
- 后续 `click` 事件自动去重，不会在 pointerdown / pointerup 后再重复播放。
- 键盘触发与音效预览没有真实 pointer 阶段时，保留兼容双声播放：鼠标按下声后约 58 ms 自动播放松开声。

## 与麻将音做响度均衡

处理后的原始短音与播放增益组合后：

| 音效 | 有效 RMS（约） | 有效峰值（约） |
| --- | ---: | ---: |
| 麻将按下 | -19.58 dBFS | 0.720 |
| 麻将松开 | -20.02 dBFS | 0.680 |
| 鼠标按下 | -19.96 dBFS | 0.694 |
| 鼠标松开 | -19.91 dBFS | 0.694 |

四个触觉短音的平均响度差控制在约 0.4 dB 内，切换 mouse / mahjong 时不再有明显音量跳变。

## UI

- 鼠标音选项名称更新为：`鼠标音 (实录双触发)`。
- 本轮不修改 Round 126 的中性 + 毛玻璃 UI 设计。

## 验证

- `node scripts/round127_mouse_audio_balance_regression.cjs`
- `node scripts/round126_audio_neutral_glass_regression.cjs`
- `node scripts/round125_flat_tight_pennant_regression.cjs`
- `tsc --noEmit --noCheck`
