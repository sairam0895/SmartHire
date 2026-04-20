export const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";

export function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("accionhire_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...(options?.headers as Record<string, string> | undefined) },
  });

  if (res.status === 401) {
    localStorage.removeItem("accionhire_token");
    localStorage.removeItem("accionhire_user");
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  return res;
}
