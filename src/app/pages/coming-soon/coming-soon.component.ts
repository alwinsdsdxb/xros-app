import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-coming-soon',
  templateUrl: './coming-soon.component.html',
  styleUrl: './coming-soon.component.scss'
})
export class ComingSoonComponent {
  title = 'Coming Soon';

  constructor(private route: ActivatedRoute) {
    this.title = this.route.snapshot.data['title'] ?? 'Coming Soon';
  }
}
