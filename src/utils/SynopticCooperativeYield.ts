/**
 * ROUND155. Yield the main thread between already-computed batches without
 * paying Chromium's nested setTimeout(0) minimum delay on every grid row.
 * It changes neither the numerical grid nor the order of any calculations.
 */
let channel: MessageChannel | undefined;
const pending: Array<() => void> = [];
function postYield(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!channel) {
    channel = new MessageChannel();
    // Node-based regression runners must be allowed to exit when idle.
    (channel.port1 as MessagePort & { unref?: () => void }).unref?.();
    (channel.port2 as MessagePort & { unref?: () => void }).unref?.();
    channel.port1.onmessage = () => {
      const resume = pending.shift();
      resume?.();
    };
  }
  return new Promise<void>(resolve => {
    pending.push(resolve);
    channel!.port2.postMessage(0);
  });
}
export async function yieldSynopticUi(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
  const nativeScheduler = (globalThis as unknown as {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (typeof nativeScheduler?.yield === 'function') await nativeScheduler.yield();
  else await postYield();
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
}
