import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-coming-soon',
  templateUrl: './coming-soon.component.html',
  styleUrl: './coming-soon.component.scss',
  standalone: true,
  imports: [MatCardModule, MatIconModule]
})
export class ComingSoonComponent {
  title = 'Coming Soon';

  constructor(private route: ActivatedRoute) {
    this.title = this.route.snapshot.data['title'] ?? 'Coming Soon';
  }
}
