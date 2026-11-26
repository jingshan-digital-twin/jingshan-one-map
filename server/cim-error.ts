import type { CimStatus } from '../src/jingshan/cim-types.ts'

export class CimError extends Error {
  status: number
  state: CimStatus
  constructor(message: string, status = 502, state: CimStatus = 'invalid') {
    super(message)
    this.status = status
    this.state = state
  }
}
