import { Component, Input } from '@angular/core';
import { ZoneHighlight, ZoneRow } from '../../../../core/models/instore-analytics.model';

export interface ZoneHighlights {
  topTrafficZone: ZoneHighlight;
  mostAttentionZone: ZoneHighlight;
  longestDwellZone: ZoneHighlight;
  opportunityZone: ZoneHighlight;
}

@Component({
  selector: 'app-zone-table-panel',
  templateUrl: './zone-table-panel.component.html',
  styleUrl: './zone-table-panel.component.scss'
})
export class ZoneTablePanelComponent {
  @Input() zones: ZoneRow[] = [];
  @Input() highlights: ZoneHighlights | null = null;

  selectedZoneKey = 'all';

  private readonly shareColors = ['#d9695a', '#e3a73c', '#e3c93c', '#a7b62e', '#4fae7a', '#1e8a57'];

  get filteredZones(): ZoneRow[] {
    if (this.selectedZoneKey === 'all') {
      return this.zones;
    }
    return this.zones.filter((z) => z.key === this.selectedZoneKey);
  }

  colorForZone(key: string): string {
    const idx = this.zones.findIndex((z) => z.key === key);
    return this.shareColors[idx % this.shareColors.length];
  }

  selectZone(key: string): void {
    this.selectedZoneKey = key;
  }

  formatDuration(seconds: number): string {
    const pad = (v: number) => v.toString().padStart(2, '0');
    const hh = Math.floor(seconds / 3600);
    const mm = Math.floor((seconds % 3600) / 60);
    const ss = Math.floor(seconds % 60);
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }
}
