import apiClient from "../api-client";

export interface SaveLeadData {
  phone?: string;
  name?: string;
  email?: string;
  address?: any;
  items?: any;
  paymentMethod?: string;
  fingerprint?: string;
}

export async function saveCheckoutLead(data: SaveLeadData) {
  try {
    const { data: res } = await apiClient.post("/checkout-leads", data);
    return res;
  } catch {
    return null;
  }
}
