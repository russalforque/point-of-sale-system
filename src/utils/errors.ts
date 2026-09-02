export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message === 'Network Error') {
    return 'Unable to reach the server. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}
