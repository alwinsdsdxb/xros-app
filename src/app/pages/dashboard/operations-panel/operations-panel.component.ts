import { Component, Input } from '@angular/core';
import { Operations } from '../../../core/models/dashboard.model';

@Component({
  selector: 'app-operations-panel',
  templateUrl: './operations-panel.component.html',
  styleUrl: './operations-panel.component.scss'
})
export class OperationsPanelComponent {
  @Input() operations: Operations | null = null;
}
