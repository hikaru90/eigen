/** Geometry only: allow a textarea to scroll before forwarding motion to the thread. */
export function canScrollInput(
  input: { scrollTop: number; scrollHeight: number; clientHeight: number },
  delta: number,
): boolean {
  return delta < 0
    ? input.scrollTop > 0
    : delta > 0 && input.scrollTop + input.clientHeight < input.scrollHeight - 1
}

export function wheelDeltaPixels(delta: number, mode: number, pageHeight: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1)
}
