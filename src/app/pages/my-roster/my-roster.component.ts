import { Component } from '@angular/core';

interface RosterDay {
  label: string;
  dateLabel: string;
  isToday: boolean;
}

@Component({
  selector: 'app-my-roster',
  templateUrl: './my-roster.component.html',
  styleUrl: './my-roster.component.scss'
})
export class MyRosterComponent {
  weekStart: Date;
  days: RosterDay[] = [];

  constructor() {
    this.weekStart = this.startOfWeek(new Date());
    this.buildDays();
  }

  get rangeLabel(): string {
    const end = this.addDays(this.weekStart, 6);
    const startMonth = this.weekStart.toLocaleDateString('en-GB', { month: 'short' });
    const endMonth = end.toLocaleDateString('en-GB', { month: 'short' });
    const startPart =
      startMonth === endMonth ? `${this.weekStart.getDate()}` : `${this.weekStart.getDate()} ${startMonth}`;
    return `${startPart} - ${end.getDate()} ${endMonth} ${end.getFullYear()}`;
  }

  get yearLabel(): string {
    return `${this.addDays(this.weekStart, 6).getFullYear()}`;
  }

  previousWeek(): void {
    this.weekStart = this.addDays(this.weekStart, -7);
    this.buildDays();
  }

  nextWeek(): void {
    this.weekStart = this.addDays(this.weekStart, 7);
    this.buildDays();
  }

  private buildDays(): void {
    const today = new Date();
    this.days = Array.from({ length: 7 }, (_, i) => {
      const d = this.addDays(this.weekStart, i);
      return {
        label: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
        dateLabel: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        isToday: this.isSameDate(d, today)
      };
    });
  }

  private startOfWeek(date: Date): Date {
    const d = new Date(date);
    const diffToMonday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diffToMonday);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private isSameDate(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
}
