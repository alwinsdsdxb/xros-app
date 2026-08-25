import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import { environment } from '../../../environments/environment';
import { AuthUser, LoginResponse } from '../models/auth.model';

const TOKEN_KEY = 'xros_token';
const USER_KEY = 'xros_user';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readStoredUser());
  readonly currentUser$: Observable<AuthUser | null> = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient) {}

  login(email: string, password: string, rememberMe = false): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password, rememberMe }).pipe(
      tap((res) => {
        const token = res?.data?.token;
        if (token) {
          // Remember me -> localStorage (survives browser restart). Unchecked
          // -> sessionStorage (cleared when the tab/browser closes). Both
          // storages are cleared first so a leftover session in the other
          // one never lingers and gets picked up by getToken()/readStoredUser().
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          sessionStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(USER_KEY);

          const storage = rememberMe ? localStorage : sessionStorage;
          storage.setItem(TOKEN_KEY, token);
          const user = this.decodeUserFromToken(token);
          if (user) {
            storage.setItem(USER_KEY, JSON.stringify(user));
          }
          this.currentUserSubject.next(user);
        }
      })
    );
  }

  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string): Observable<any> {
    return this.http.post(`${environment.apiUrl}/auth/reset-password`, { password, token });
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this.currentUserSubject.next(null);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  get currentUser(): AuthUser | null {
    return this.currentUserSubject.value;
  }

  private readStoredUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY) ?? sessionStorage.getItem(USER_KEY);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  private decodeUserFromToken(token: string): AuthUser | null {
    try {
      const decoded = jwtDecode<Record<string, unknown>>(token);
      return {
        id: decoded['userId'] as string | undefined,
        email: (decoded['email'] as string) ?? '',
        name: (decoded['name'] as string) ?? (decoded['email'] as string) ?? 'User',
        role: (decoded['roleId'] as string) ?? 'User',
        company: decoded['company'] as string | undefined,
        tenantId: decoded['tenantId'] as string | undefined,
        accountType: decoded['accountType'] as string | undefined,
        defaultDashboard: decoded['defaultDashboard'] as string | undefined
      };
    } catch {
      return null;
    }
  }
}
