/** Input the command refuses before PostgreSQL sees it: a malformed token, name or value. */
export class InputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}
