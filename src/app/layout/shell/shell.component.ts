import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subject, filter, takeUntil } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { AuthUser } from '../../core/models/auth.model';
import { StoreContextService } from '../../core/services/store-context.service';

interface NavItem {
  label: string;
  route: string;
}

@Component({
  selector: 'app-shell',
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss'
})
export class ShellComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  currentUser: AuthUser | null = null;
  pageTitle = 'Analytics Dashboard';
  storeName = 'All Stores';
  mobileNavOpen = false;

  readonly primaryNav: NavItem[] = [{ label: 'XR Dashboard™', route: '/dashboard' }];

  readonly secondaryNav: NavItem[] = [
    { label: 'XR Store Health Score™', route: '/store-health-score' },
    { label: 'XR Stores Comparisons™', route: '/stores-comparisons' },
    { label: 'XR Marketing Intelligence™', route: '/marketing-intelligence' },
    { label: 'XR Sales Data Flow™', route: '/sales-data-flow' },
    { label: 'XR ClimateIQ™', route: '/climate-iq' }
  ];

  readonly adminNavA: NavItem[] = [
    { label: 'My Roster', route: '/my-roster' },
    { label: 'XR Workforce Intelligence™', route: '/workforce-intelligence' }
  ];

  readonly adminNavB: NavItem[] = [
    { label: 'Employees', route: '/employees' },
    { label: 'Settings', route: '/settings' }
  ];

  constructor(
    private authService: AuthService,
    private storeContextService: StoreContextService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.currentUser = user;
    });

    this.storeContextService.storeName$.pipe(takeUntil(this.destroy$)).subscribe((storeName) => {
      this.storeName = storeName;
    });

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.updatePageTitle();
        this.mobileNavOpen = false;
      });

    this.updatePageTitle();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleMobileNav(): void {
    this.mobileNavOpen = !this.mobileNavOpen;
  }

  closeMobileNav(): void {
    this.mobileNavOpen = false;
  }

  signOut(): void {
    this.authService.logout();
    this.router.navigate(['/login'], { queryParams: { reason: 'signed-out' } });
  }

  private updatePageTitle(): void {
    let child = this.route.firstChild;
    while (child?.firstChild) {
      child = child.firstChild;
    }
    const title = child?.snapshot.data['title'];
    this.pageTitle = title === 'XR Dashboard' ? 'Analytics Dashboard' : title ?? 'Analytics Dashboard';
  }
}
