import apiClient from "../api-client";

export interface UserSettings {
  id: string;
  userId: string;
  autoVariantSelect: boolean;
}

export async function getSettings(): Promise<UserSettings> {
  const { data } = await apiClient.get("/users/settings");
  return data;
}

export async function updateSettings(dto: { autoVariantSelect?: boolean }) {
  const { data } = await apiClient.put("/users/settings", dto);
  return data;
}
