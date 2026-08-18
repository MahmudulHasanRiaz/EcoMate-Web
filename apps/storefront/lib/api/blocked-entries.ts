import apiClient from "../api-client";

export async function checkPhoneBlocked(phone: string): Promise<boolean> {
  try {
    const { data } = await apiClient.get(
      `/blocked-entries/check/phone/${encodeURIComponent(phone)}`,
    );
    return !!data.blocked;
  } catch {
    return false;
  }
}