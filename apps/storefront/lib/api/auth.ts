import apiClient from "../api-client";
import type { User } from "../types";

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const { data } = await apiClient.post("/auth/login", { email, password });
  return data;
}

export async function register(data: {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phoneNumber: string;
  password: string;
}): Promise<AuthResponse> {
  const { data: res } = await apiClient.post("/auth/register", data);
  return res;
}

export async function getMe(): Promise<User> {
  const { data } = await apiClient.get("/auth/me");
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function refreshToken(): Promise<AuthResponse> {
  const { data } = await apiClient.post("/auth/refresh");
  return data;
}
