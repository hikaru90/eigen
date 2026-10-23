/** A board refusal with the HTTP status the endpoint returns (400/403/404/409/502). */
export class BoardError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'BoardError'
    this.status = status
  }
}

export function isBoardError(err: unknown): err is BoardError {
  return err instanceof BoardError
}
