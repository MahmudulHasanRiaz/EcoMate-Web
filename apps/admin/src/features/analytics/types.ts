export interface SalesKpi {
  totalRevenue: number;
  totalOrders: number;
  aov: number;
  refundRate: number;
  totalRefunds: number;
}

export interface RevenueTrend {
  data: { date: string; revenue: number }[];
}

export interface MarketingKpi {
  pageViews: number;
  uniqueVisitors: number;
  bounceRate: number;
  pagesPerSession: number;
}

export interface TrafficSources {
  sources: { source: string; visits: number; percentage: number }[];
}

export interface StatusCount {
  status: string;
  count: number;
  totalAmount?: number;
}

export interface RevenueByMethod {
  method: string;
  revenue: number;
}

export interface TopProduct {
  id: string;
  name: string;
  image: string;
  quantity: number;
}

export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}
