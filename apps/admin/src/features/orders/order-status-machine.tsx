import { useMemo, useState } from 'react'
import { ORDER_TRANSITIONS, STATUS_COLORS, STATUS_LAYOUT } from './status-transitions'
import { cn } from '@/lib/utils'

interface Props {
  currentStatusName: string
  statusList: { id: string; name: string }[]
  allowedNextIds: string[]
  onStatusClick: (statusId: string) => void
}

const NODE_W = 130
const NODE_H = 36
const COL_GAP = 16
const ROW_GAP = 60
const PADDING = 20

export function OrderStatusMachine({ currentStatusName, statusList, allowedNextIds, onStatusClick }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const layout = useMemo(() => {
    return STATUS_LAYOUT.map((node) => ({
      ...node,
      x: PADDING + node.column * (NODE_W + COL_GAP),
      y: PADDING + node.row * (NODE_H + ROW_GAP),
    }))
  }, [])

  const edges = useMemo(() => {
    const result: { from: string; to: string; path: string }[] = []
    layout.forEach((from) => {
      const targets = ORDER_TRANSITIONS[from.name] || []
      targets.forEach((toName) => {
        const to = layout.find((n) => n.name === toName)
        if (!to) return
        const x1 = from.x + NODE_W
        const y1 = from.y + NODE_H / 2
        const x2 = to.x
        const y2 = to.y + NODE_H / 2
        const isSameRow = from.row === to.row
        const path = isSameRow
          ? `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`
          : from.y < to.y
            ? `M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`
            : `M ${from.x + NODE_W / 2} ${from.y + NODE_H} C ${from.x + NODE_W / 2} ${from.y + NODE_H + 20}, ${to.x + NODE_W / 2} ${to.y - 10}, ${to.x + NODE_W / 2} ${to.y}`
        result.push({ from: from.name, to: toName, path })
      })
    })
    return result
  }, [layout])

  const svgW = PADDING * 2 + (Math.max(...layout.map((n) => n.column)) + 1) * (NODE_W + COL_GAP)
  const svgH = PADDING * 2 + (Math.max(...layout.map((n) => n.row)) + 1) * (NODE_H + ROW_GAP)

  return (
    <div className='w-full overflow-auto rounded-md border bg-card p-4'>
      <svg width={svgW} height={svgH} className='min-w-full'>
        <defs>
          {layout.map((node) => (
            <filter key={node.name} id={`glow-${node.name.replace(/\s+/g, '-')}`}>
              <feGaussianBlur stdDeviation='3' result='blur' />
              <feMerge><feMergeNode in='blur' /><feMergeNode in='SourceGraphic' /></feMerge>
            </filter>
          ))}
        </defs>

        {/* Edges */}
        {edges.map((edge) => {
          const isFromCurrent = edge.from === currentStatusName
          const isAllowed = isFromCurrent && allowedNextIds.some(
            (id) => statusList.find((s) => s.name === edge.to)?.id === id
          )
          const strokeColor = isAllowed ? '#22C55E' : '#E5E7EB'
          const strokeWidth = isAllowed ? 2.5 : 1.5
          const opacity = isAllowed ? 1 : 0.4
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={edge.path}
              fill='none'
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeLinecap='round'
              className={isAllowed ? 'transition-all duration-300' : ''}
            />
          )
        })}

        {/* Nodes */}
        {layout.map((node) => {
          const isCurrent = node.name === currentStatusName
          const isAllowed = allowedNextIds.some((id) => statusList.find((s) => s.name === node.name)?.id === id) && node.name !== currentStatusName
          const isClickable = isAllowed || isCurrent
          const fillColor = STATUS_COLORS[node.name] || '#6B7280'

          return (
            <g
              key={node.name}
              className={cn(
                'transition-all duration-200',
                isClickable ? 'cursor-pointer' : 'cursor-default'
              )}
              onClick={() => {
                if (isAllowed) {
                  const status = statusList.find((s) => s.name === node.name)
                  if (status) onStatusClick(status.id)
                }
              }}
              onMouseEnter={() => setHovered(node.name)}
              onMouseLeave={() => setHovered(null)}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={fillColor}
                opacity={isCurrent ? 1 : 0.85}
                filter={isCurrent ? `url(#glow-${node.name.replace(/\s+/g, '-')})` : undefined}
                stroke={hovered === node.name ? '#fff' : 'transparent'}
                strokeWidth={isCurrent ? 2 : hovered === node.name ? 2 : 0}
              />
              <text
                x={node.x + NODE_W / 2}
                y={node.y + NODE_H / 2}
                textAnchor='middle'
                dominantBaseline='central'
                fill='#fff'
                fontSize={11}
                fontWeight={isCurrent ? 'bold' : 'normal'}
              >
                {node.name}
              </text>
              {isCurrent && (
                <text
                  x={node.x + NODE_W / 2}
                  y={node.y + NODE_H + 14}
                  textAnchor='middle'
                  fill='#6B7280'
                  fontSize={10}
                >
                  Current
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
