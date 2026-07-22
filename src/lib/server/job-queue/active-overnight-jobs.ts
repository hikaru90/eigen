/** In-process overnight job ids — empty after dev server reload until a job is claimed again. */
const activeOvernightJobIds = new Set<string>()

export function markOvernightJobActive(jobId: string): void {
  activeOvernightJobIds.add(jobId)
}

export function markOvernightJobInactive(jobId: string): void {
  activeOvernightJobIds.delete(jobId)
}

export function isOvernightJobActiveInProcess(jobId: string): boolean {
  return activeOvernightJobIds.has(jobId)
}
