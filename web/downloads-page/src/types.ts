export interface Mirror {
  platform: string
  file: string
  size: number
  sha256: string
  url: string
  slug?: string
  source?: string
}

export interface DownloadRow {
  platform: string
  file?: string
  size?: number
  note?: string
  slug?: string
  url?: string
}

export interface Item {
  id: string
  name: string
  summary: string
  category: string
  platforms?: string[]
  version?: string
  license?: string
  repository?: string
  official?: string
  channel?: string
  guide?: string
  guideLabel?: string
  mirror?: Mirror
  note?: string
  install?: string
  release?: string
  downloads?: DownloadRow[]
  icon?: string
  download_url?: string
  landing_page?: string
  originMirror?: string
  r2Mirror?: string
  disabled?: boolean
}

export interface Manifest {
  schemaVersion?: number
  updatedAt?: string
  mirrorBase?: string
  notice?: string
  items: Item[]
}
