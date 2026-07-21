import { useQuery } from '@tanstack/react-query'
import { securityApi } from '../api'

export function useSecuritySummary() {
  return useQuery({
    queryKey: ['security-summary'],
    queryFn: () => securityApi.getSummary(),
    refetchInterval: 60_000,
  })
}

export function useSecurityTimeline(params?: {
  limit?: number
  cursor?: string
  severity?: string
  category?: string
  eventType?: string
}) {
  return useQuery({
    queryKey: ['security-timeline', params],
    queryFn: () => securityApi.getTimeline(params),
  })
}

export function useSecurityTrends(params: {
  interval: 'hourly' | 'daily'
  from?: string
  to?: string
  severity?: string
  eventType?: string
  category?: string
}) {
  return useQuery({
    queryKey: ['security-trends', params],
    queryFn: () => securityApi.getTrends(params),
  })
}

export function useSecurityTopOffenders(params?: {
  window?: '1h' | '24h' | '7d'
  limit?: number
  actorType?: string
}) {
  return useQuery({
    queryKey: ['security-top-offenders', params],
    queryFn: () => securityApi.getTopOffenders(params),
    refetchInterval: 120_000,
  })
}

export function useSecurityBlockActivity(params?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['security-block-activity', params],
    queryFn: () => securityApi.getBlockActivity(params),
  })
}

export function useSecurityEventDetail(id: string) {
  return useQuery({
    queryKey: ['security-event-detail', id],
    queryFn: () => securityApi.getEventDetail(id),
    enabled: !!id,
  })
}

export function useSecurityCorrelationChain(id: string) {
  return useQuery({
    queryKey: ['security-correlation-chain', id],
    queryFn: () => securityApi.getCorrelationChain(id),
    enabled: !!id,
  })
}

export function useSecurityRetentionConfig() {
  return useQuery({
    queryKey: ['security-retention-config'],
    queryFn: () => securityApi.getRetentionConfig(),
  })
}
