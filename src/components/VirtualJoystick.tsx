/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from "react";
import { Move } from "lucide-react";

interface JoystickProps {
  compact?: boolean;
  dx: number;
  dy: number;
  onChange: (dx: number, dy: number, dragging?: boolean) => void;
  strength: number;
  enabled: boolean;
  returnToCenter: boolean;
}

export default function VirtualJoystick({ compact = false, dx, dy, onChange, strength, enabled, returnToCenter }: JoystickProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  // Phone geometry still shares the lower edge with the transport dock, but Round 34 gives the
  // steering surface a little more room so small directional corrections are easier on touch.
  const diameter = compact ? 116 : 164;
  const radius = diameter / 2;
  const knobRadius = compact ? 22 : 28;
  const maxDistance = radius - knobRadius;

  const [isDragging, setIsDragging] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const lastNotifyRef = useRef(0);
  const visualRafRef = useRef<number | null>(null);
  const pendingVisualRef = useRef<{ x: number; y: number } | null>(null);
  const initialPos = {
    x: Math.max(-1, Math.min(1, dx)) * maxDistance,
    y: -Math.max(-1, Math.min(1, dy)) * maxDistance
  };
  const [pos, setPos] = useState(initialPos);
  const posRef = useRef(initialPos);

  // Pointer streams can exceed 200 Hz. Move the knob directly once per display frame and reserve
  // React state for stable boundaries (release/external sync), avoiding a whole-app reconciliation
  // for every raw pointer sample.
  const setVisualPos = (next: { x: number; y: number }, commitReact = false) => {
    posRef.current = next;
    pendingVisualRef.current = next;
    if (commitReact) setPos(next);
    if (visualRafRef.current !== null) return;
    visualRafRef.current = requestAnimationFrame(() => {
      visualRafRef.current = null;
      const latest = pendingVisualRef.current;
      if (!latest || !handleRef.current) return;
      handleRef.current.style.transform = `translate(${latest.x}px, ${latest.y}px)`;
    });
  };

  useEffect(() => () => {
    if (visualRafRef.current !== null) cancelAnimationFrame(visualRafRef.current);
  }, []);

  const normalizedFromPos = (p = posRef.current) => ({
    dx: Math.max(-1, Math.min(1, p.x / maxDistance)),
    dy: Math.max(-1, Math.min(1, -p.y / maxDistance))
  });

  const updatePosition = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // R221: the compact landscape rail scales the visual joystick.  Convert
    // viewport pointer coordinates back into its *logical* 116px coordinate
    // system before applying the same steering radius in either orientation.
    // Otherwise a 0.78x rendered joystick reaches only ~78% of its real range.
    const visualScaleX = Math.max(0.1, rect.width / diameter);
    const visualScaleY = Math.max(0.1, rect.height / diameter);
    let deltaX = (clientX - centerX) / visualScaleX;
    let deltaY = (clientY - centerY) / visualScaleY;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance > maxDistance) {
      const angle = Math.atan2(deltaY, deltaX);
      deltaX = Math.cos(angle) * maxDistance;
      deltaY = Math.sin(angle) * maxDistance;
    }

    const next = { x: deltaX, y: deltaY };
    setVisualPos(next);
    const now = performance.now();
    if (now - lastNotifyRef.current >= 32) {
      lastNotifyRef.current = now;
      const normalized = normalizedFromPos(next);
      onChange(normalized.dx, normalized.dy, true);
    }
  };

  const finishDrag = () => {
    if (activePointerRef.current === null) return;
    activePointerRef.current = null;
    const normalized = normalizedFromPos();
    setVisualPos(posRef.current, true);
    setIsDragging(false);
    onChange(normalized.dx, normalized.dy, false);
  };

  // With auto-return disabled, the visual handle follows the persisted config value even after
  // release, pause/resume or a config restore.
  useEffect(() => {
    if (isDragging || returnToCenter) return;
    const target = {
      x: Math.max(-1, Math.min(1, dx)) * maxDistance,
      y: -Math.max(-1, Math.min(1, dy)) * maxDistance
    };
    if (Math.abs(posRef.current.x - target.x) >= 0.05 || Math.abs(posRef.current.y - target.y) >= 0.05) {
      setVisualPos(target, true);
    }
  }, [dx, dy, isDragging, returnToCenter, maxDistance]);

  // Optional spring return. During the spring only the knob transform is animated; the model
  // receives bounded 32-ms steering updates and React gets a single final center commit.
  useEffect(() => {
    if (isDragging || !returnToCenter) return;
    const releasePos = posRef.current;
    if (Math.abs(releasePos.x) < 0.05 && Math.abs(releasePos.y) < 0.05) {
      if (dx !== 0 || dy !== 0) onChange(0, 0, false);
      if (releasePos.x !== 0 || releasePos.y !== 0) setVisualPos({ x: 0, y: 0 }, true);
      return;
    }

    const startX = releasePos.x;
    const startY = releasePos.y;
    const startAt = performance.now();
    const durationMs = 210;
    let animFrame = 0;

    const animate = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - startAt) / durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      const next = { x: startX * (1 - eased), y: startY * (1 - eased) };
      setVisualPos(next, t >= 1);
      if (t >= 1 || now - lastNotifyRef.current >= 32) {
        lastNotifyRef.current = now;
        const normalized = normalizedFromPos(next);
        onChange(t >= 1 ? 0 : normalized.dx, t >= 1 ? 0 : normalized.dy, false);
      }
      if (t < 1) animFrame = requestAnimationFrame(animate);
      else setVisualPos({ x: 0, y: 0 }, true);
    };

    animFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, returnToCenter]);

  return (
    <div className="relative">
      <div
        id="joystick-container"
        ref={containerRef}
        className={`relative rounded-full flex items-center justify-center select-none transition-all duration-200 border ${
          enabled
            ? "bg-slate-800/30 backdrop-blur-[10px] border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,.20),0_10px_25px_rgba(0,0,0,.16)]"
            : "bg-slate-800/30 backdrop-blur-[10px] border-white/15 opacity-40 cursor-not-allowed"
        }`}
        style={{ width: `${diameter}px`, height: `${diameter}px`, touchAction: "none" }}
        onPointerDown={(e) => {
          if (!enabled || (e.pointerType === "mouse" && e.button !== 0) || activePointerRef.current !== null) return;
          e.preventDefault(); e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          activePointerRef.current = e.pointerId;
          lastNotifyRef.current = -Infinity;
          setIsDragging(true);
          updatePosition(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!enabled || activePointerRef.current !== e.pointerId) return;
          e.preventDefault(); e.stopPropagation();
          updatePosition(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (activePointerRef.current !== e.pointerId) return;
          e.stopPropagation();
          finishDrag();
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={(e) => { if (activePointerRef.current === e.pointerId) finishDrag(); }}
        onLostPointerCapture={() => { if (activePointerRef.current !== null) finishDrag(); }}
      >
        <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
          <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-slate-800/60 -translate-x-1/2"></div>
          <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-slate-800/60 -translate-y-1/2"></div>
          <div className="absolute top-1/2 left-1/2 w-2/3 h-2/3 border border-slate-900/50 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
          <div className="absolute top-1/2 left-1/2 w-1/3 h-1/3 border border-slate-900/50 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
        </div>

        <div
          id="joystick-handle"
          ref={handleRef}
          className={`absolute rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing shadow-lg transition-shadow duration-150 pointer-events-none ${
            isDragging
              ? "bg-[#1E9CFF] shadow-[0_0_12px_rgba(30,156,255,0.6)] text-white"
              : "bg-slate-700/30 backdrop-blur-md text-slate-100 border border-white/30"
          }`}
          style={{
            width: `${knobRadius * 2}px`,
            height: `${knobRadius * 2}px`,
            transform: `translate(${pos.x}px, ${pos.y}px)`,
          }}
          title={`推力 ${strength.toFixed(1)}级 · ${returnToCenter ? "松手回中" : "松手保持位置"}`}
        >
          <Move className={compact ? "w-4 h-4" : "w-5 h-5"} />
        </div>
      </div>
    </div>
  );
}
