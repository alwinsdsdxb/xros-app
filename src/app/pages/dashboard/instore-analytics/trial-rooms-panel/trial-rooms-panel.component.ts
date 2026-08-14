import { Component, Input } from '@angular/core';
import { TrialRoomZoneMatch, TrialRoomZoneProxy } from '../../../../core/models/instore-analytics.model';

@Component({
  selector: 'app-trial-rooms-panel',
  templateUrl: './trial-rooms-panel.component.html',
  styleUrl: './trial-rooms-panel.component.scss'
})
export class TrialRoomsPanelComponent {
  @Input() proxy: TrialRoomZoneProxy | null = null;

  formatDuration(seconds: number): string {
    const pad = (v: number) => v.toString().padStart(2, '0');
    const hh = Math.floor(seconds / 3600);
    const mm = Math.floor((seconds % 3600) / 60);
    const ss = Math.floor(seconds % 60);
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }

  // Real ratios derived from the zone's own traffic/visitors/attentionVisitors -
  // same "attention capture" ratio the Zone Table panel already uses, not a
  // fabricated percentage.
  visitRatePct(z: TrialRoomZoneMatch): number {
    return z.traffic > 0 ? Math.round((z.visitors / z.traffic) * 100) : 0;
  }

  attentionRatePct(z: TrialRoomZoneMatch): number {
    return z.traffic > 0 ? Math.round((z.attentionVisitors / z.traffic) * 100) : 0;
  }
}
