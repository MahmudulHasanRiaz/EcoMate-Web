import apiClient from "../api-client";

export interface BDDistrict {
  name: string;
  nameBn?: string;
  charge: number | null;
  thanaCount: number;
}

export interface BDThana {
  name: string;
  nameBn?: string;
}

export async function getDistricts(): Promise<BDDistrict[]> {
  const { data } = await apiClient.get("/delivery-areas/districts");
  return data;
}

export async function getThanas(district: string): Promise<BDThana[]> {
  const { data } = await apiClient.get(`/delivery-areas/districts/${encodeURIComponent(district)}/thanas`);
  return data;
}

export interface GatewayConfig {
  id: string;
  gateway: string;
  enabled: boolean;
  mode: string;
  phoneNumber?: string;
}

export async function getGateways(): Promise<GatewayConfig[]> {
  const { data } = await apiClient.get("/gateways");
  return data;
}
