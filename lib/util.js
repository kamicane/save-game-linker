export class LinkError extends Error {
  constructor (code, message) {
    super(message)
    this.code = code
    this.name = 'LinkError'
  }
}
