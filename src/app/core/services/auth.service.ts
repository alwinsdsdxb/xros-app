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

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap((res) => {
        if (res?.accessToken) {
          localStorage.setItem(TOKEN_KEY, res.accessToken);
          const user = res.user ?? this.decodeUserFromToken(res.accessToken);
          if (user) {
            localStorage.setItem(USER_KEY, JSON.stringify(user));
          }
          this.currentUserSubject.next(user);
        }
      })
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.currentUserSubject.next(null);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  get currentUser(): AuthUser | null {
    return this.currentUserSubject.value;
  }

  private readStoredUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
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
        email: (decoded['email'] as string) ?? '',
        name: (decoded['name'] as string) ?? (decoded['email'] as string) ?? 'User',
        role: (decoded['role'] as string) ?? 'User'
      };
    } catch {
      return null;
    }
  }
}
