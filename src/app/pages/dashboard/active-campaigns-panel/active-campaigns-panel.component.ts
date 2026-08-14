import { Component, Input } from '@angular/core';
import { CampaignEvent } from '../../../core/models/dashboard.model';

@Component({
  selector: 'app-active-campaigns-panel',
  templateUrl: './active-campaigns-panel.component.html',
  styleUrl: './active-campaigns-panel.component.scss'
})
export class ActiveCampaignsPanelComponent {
  @Input() campaigns: CampaignEvent[] | null = null;

  // The window to scope campaigns to - each host tab passes its own currently
  // selected View/Date filter range here (e.g. the whole year when View is
  // "Year"), so a campaign shows whenever it overlaps that range rather than
  // only "not ended yet relative to right now". Falls back to the old
  // "not yet ended" behavior if a host hasn't wired these in.
  @Input() rangeFrom: Date | null = null;
  @Input() rangeTo: Date | null = null;

  get visibleCampaigns(): CampaignEvent[] {
    const all = this.campaigns ?? [];

    if (!this.rangeFrom || !this.rangeTo) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return [...all]
        .filter((c) => new Date(c.to) >= today)
        .sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
    }

    const from = this.rangeFrom.getTime();
    const to = this.rangeTo.getTime();
    return [...all]
      .filter((c) => new Date(c.to).getTime() >= from && new Date(c.from).getTime() <= to)
      .sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
  }

  get headerRangeLabel(): string | null {
    if (!this.rangeFrom || !this.rangeTo) {
      return null;
    }
    return this.formatRangeDates(this.rangeFrom, this.rangeTo);
  }

  formatRange(from: string, to: string): string {
    return this.formatRangeDates(new Date(from), new Date(to));
  }

  private formatRangeDates(from: Date, to: Date): string {
    const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${fmt(from)} to ${fmt(to)}`;
  }
}
