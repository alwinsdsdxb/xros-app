import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  // Only the real backend gets this app's own bearer token. Without this
  // check, setHeaders below overwrites ANY Authorization header already on
  // the request - including the Vion token queue-hourly.service.ts sets for
  // its direct browser calls to a third-party host - with this app's own
  // login JWT instead.
  const isOwnApi = req.url.startsWith(environment.apiUrl);

  if (token && isOwnApi) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }

  const isLoginRequest = req.url.endsWith('/auth/login');

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isLoginRequest && authService.isLoggedIn()) {
        authService.logout();
        router.navigate(['/login'], { queryParams: { reason: 'expired' } });
      }
      return throwError(() => error);
    })
  );
};
