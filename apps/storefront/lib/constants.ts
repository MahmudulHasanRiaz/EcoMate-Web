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
