export interface AuthUser {
  id?: string;
  email: string;
  name?: string;
  role?: string;
}

export interface LoginResponse {
  accessToken: string;
  user?: AuthUser;
}
