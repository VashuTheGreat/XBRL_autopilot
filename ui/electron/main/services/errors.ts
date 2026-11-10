/** Typed service errors. The IPC layer turns them into user-facing messages. */

/** User input failed validation; `problems` are ready to show next to the form. */
export class ValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('\n'))
    this.name = 'ValidationError'
  }
}

/** The project has never been saved: the caller must ask for a path (Save As). */
export class NoSavePathError extends Error {
  constructor() {
    super('Choose where to save this filing.')
    this.name = 'NoSavePathError'
  }
}

export class NoProjectError extends Error {
  constructor() {
    super('No filing is open.')
    this.name = 'NoProjectError'
  }
}

export class ReadOnlyProjectError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ReadOnlyProjectError'
  }
}
