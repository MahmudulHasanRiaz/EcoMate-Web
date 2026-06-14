import apiClient from "../api-client";

export interface AddressData {
  id?: string;
  label: string;
  fullName: string;
  phoneNumber: string;
  street: string;
  city: string;
  state?: string;
  zipCode?: string;
  country?: string;
  isDefault?: boolean;
}

export async function getAddresses(): Promise<AddressData[]> {
  const { data } = await apiClient.get("/addresses");
  return data;
}

export async function createAddress(dto: AddressData) {
  const { data } = await apiClient.post("/addresses", dto);
  return data;
}

export async function updateAddress(id: string, dto: Partial<AddressData>) {
  const { data } = await apiClient.put(`/addresses/${id}`, dto);
  return data;
}

export async function deleteAddress(id: string) {
  const { data } = await apiClient.delete(`/addresses/${id}`);
  return data;
}

export async function setDefaultAddress(id: string) {
  const { data } = await apiClient.patch(`/addresses/${id}/default`);
  return data;
}
