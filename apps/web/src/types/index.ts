export interface Role {
  code: string;
  nameAr: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  permissions: string[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}
