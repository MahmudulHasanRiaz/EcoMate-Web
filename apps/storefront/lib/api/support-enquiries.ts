import apiClient from "../api-client";

export interface SupportEnquiryPayload {
  name: string;
  email?: string;
  phone?: string;
  subject?: string;
  message: string;
  orderId?: string;
  /** Honeypot — must stay empty; bots fill it. */
  website?: string;
}

export async function submitSupportEnquiry(
  payload: SupportEnquiryPayload,
): Promise<void> {
  await apiClient.post("/support-enquiries", payload);
}
