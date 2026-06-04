const _PH = (s: string) => s.replace(/\s+/g, ' ')
export const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    _PH(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
      <rect width="600" height="600" fill="#f0f4ff"/>
      <g transform="translate(300,240)">
        <rect x="-36" y="-27" width="72" height="54" rx="6" fill="#93c5fd" opacity="0.5"/>
        <circle cx="12" cy="-6" r="12" fill="#93c5fd" opacity="0.5"/>
        <rect x="-30" y="9" width="60" height="30" rx="3" fill="#93c5fd" opacity="0.5"/>
      </g>
      <text x="300" y="345" font-family="system-ui,sans-serif" font-size="21" fill="#3b82f6"
            text-anchor="middle" font-weight="500">No Image</text>
    </svg>`),
  )

export const PRODUCT_BLUR_DATA_URL =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    _PH(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
      <rect width="600" height="600" fill="#f5f5f5"/>
      <rect x="120" y="200" width="360" height="240" rx="8" fill="#e5e7eb"/>
      <circle cx="400" cy="240" r="20" fill="#d1d5db"/>
    </svg>`),
  )

export const COMBO_BLUR_DATA_URL =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    _PH(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
      <rect width="600" height="600" fill="#eef2ff"/>
      <rect x="100" y="220" width="400" height="200" rx="12" fill="#c7d2fe"/>
      <path d="M180 360 L300 280 L420 360 Z" fill="#a5b4fc"/>
      <circle cx="380" cy="260" r="16" fill="#a5b4fc"/>
    </svg>`),
  )
