export interface AuthUser {
  id?: string;
  email: string;
  name?: string;
  role?: string;
  company?: string;
  tenantId?: string;
  accountType?: string;
  defaultDashboard?: string;
}

export interface LoginResponse {
  statusCode: number;
  message: string;
  data: {
    token: string;
  };
}
