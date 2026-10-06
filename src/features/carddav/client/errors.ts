import i18n from '@/lib/i18n'

export class CardDAVConflictError extends Error {
  currentEtag: string
  serverData?: string
  constructor(currentEtag: string, serverData?: string) {
    super(i18n.t('errors:ui.carddav.conflict'))
    this.name = 'CardDAVConflictError'
    this.currentEtag = currentEtag
    this.serverData = serverData
  }
}

export class CardDAVPermissionError extends Error {
  constructor() {
    super(i18n.t('errors:ui.carddav.permission'))
    this.name = 'CardDAVPermissionError'
  }
}

export class CardDAVSizeLimitError extends Error {
  maxSize: number
  actualSize: number
  constructor(maxSize: number, actualSize: number) {
    super(i18n.t('errors:ui.carddav.sizeLimit', { max: maxSize }))
    this.name = 'CardDAVSizeLimitError'
    this.maxSize = maxSize
    this.actualSize = actualSize
  }
}

export class CardDAVVersionError extends Error {
  supportedVersions: ('3.0' | '4.0')[]
  constructor(supportedVersions: ('3.0' | '4.0')[]) {
    super(i18n.t('errors:ui.carddav.version'))
    this.name = 'CardDAVVersionError'
    this.supportedVersions = supportedVersions
  }
}
