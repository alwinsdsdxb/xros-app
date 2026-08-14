import { AfterViewInit, Component, ElementRef, HostListener, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import { FloorPlanReport, FloorPlanZoneData } from '../../../../core/models/instore-analytics.model';

interface FloorPlanShape {
  zone: FloorPlanZoneData;
  points: { x: number; y: number }[];
  path: Path2D;
  fill: string;
  stroke: string;
}

// Zone coordinates are authored against a fixed 1920x1080 reference frame
// regardless of the source photo's actual resolution, so they're normalized
// to that frame before being rescaled onto the canvas.
const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;

// Validated categorical palette (dataviz skill default) - fixed order, one hue
// per zone by index. Passes CVD/normal-vision separation on a white card
// surface; the three slots that fall under 3:1 contrast (aqua/yellow/magenta)
// rely on the legend + tooltip labels as relief, never on hue alone.
const ZONE_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

@Component({
  selector: 'app-floor-plan-panel',
  templateUrl: './floor-plan-panel.component.html',
  styleUrl: './floor-plan-panel.component.scss'
})
export class FloorPlanPanelComponent implements OnChanges, AfterViewInit {
  @Input() data: FloorPlanReport | null = null;

  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('tooltip') private tooltipRef!: ElementRef<HTMLDivElement>;

  legend: { zone: FloorPlanZoneData; fill: string; stroke: string }[] = [];
  highlightedZone: string | null = null;

  private viewReady = false;
  private shapes: FloorPlanShape[] = [];
  private loadedImage: HTMLImageElement | null = null;
  private readonly onMouseMove = (event: MouseEvent) => this.handleMouseMove(event);
  private readonly onMouseLeave = () => this.setHighlight(null);

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.viewReady) {
      this.render();
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.loadedImage) {
      this.draw(this.canvasRef.nativeElement, this.loadedImage);
    }
  }

  setHighlight(zoneName: string | null): void {
    if (this.highlightedZone === zoneName) {
      return;
    }
    this.highlightedZone = zoneName;
    this.redrawShapes();
  }

  private render(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    this.loadedImage = null;
    this.legend = [];

    if (!this.data?.image) {
      this.shapes = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const image = new Image();
    image.onload = () => this.draw(canvas, image);
    image.onerror = () => {
      this.shapes = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    image.src = this.data.image;
  }

  private draw(canvas: HTMLCanvasElement, image: HTMLImageElement): void {
    this.loadedImage = image;

    const width = canvas.parentElement?.clientWidth || image.width;
    const height = width / (image.width / image.height);

    canvas.width = width;
    canvas.height = height;

    const zones = this.data?.zones ?? [];
    this.shapes = zones.map((zone, index) => {
      const color = ZONE_PALETTE[index % ZONE_PALETTE.length];
      const points = zone.coordinates.map((p) => ({
        x: (p.x / REFERENCE_WIDTH) * width,
        y: (p.y / REFERENCE_HEIGHT) * height
      }));
      return {
        zone,
        fill: this.withAlpha(color, 0.5),
        stroke: color,
        points,
        path: this.buildPath(points)
      };
    });
    this.legend = this.shapes.map((s) => ({ zone: s.zone, fill: s.stroke, stroke: s.stroke }));

    canvas.removeEventListener('mousemove', this.onMouseMove);
    canvas.removeEventListener('mouseleave', this.onMouseLeave);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mouseleave', this.onMouseLeave);

    this.redrawShapes();
  }

  private redrawShapes(): void {
    const canvas = this.canvasRef?.nativeElement;
    const image = this.loadedImage;
    if (!canvas || !image) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const shape of this.shapes) {
      this.drawShape(ctx, shape, shape.zone.zoneName === this.highlightedZone);
    }
  }

  private drawShape(ctx: CanvasRenderingContext2D, shape: FloorPlanShape, highlighted: boolean): void {
    if (!shape.points.length) {
      return;
    }

    ctx.fillStyle = highlighted ? this.withAlpha(shape.stroke, 0.7) : shape.fill;
    ctx.strokeStyle = shape.stroke;
    ctx.lineWidth = highlighted ? 3.5 : 2;
    ctx.fill(shape.path);
    ctx.stroke(shape.path);
  }

  // Path2D + isPointInPath (below) so hit-testing always matches what's
  // actually painted - a hand-rolled even-odd ray-cast disagrees with
  // ctx.fill()'s default nonzero winding rule on any non-convex/notched zone
  // shape, letting one zone's hit region silently swallow its neighbors'.
  private buildPath(points: { x: number; y: number }[]): Path2D {
    const path = new Path2D();
    points.forEach((point, index) => {
      if (index === 0) {
        path.moveTo(point.x, point.y);
      } else {
        path.lineTo(point.x, point.y);
      }
    });
    path.closePath();
    return path;
  }

  private handleMouseMove(event: MouseEvent): void {
    const canvas = this.canvasRef.nativeElement;
    const tooltip = this.tooltipRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    // Mouse position in the canvas's displayed CSS-pixel space - this is what
    // the tooltip element (a normal DOM node, absolutely positioned over the
    // canvas) must be placed in.
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;

    // shape.points are authored in the canvas's internal buffer-pixel space
    // (canvas.width/height from draw()), which only equals rect.width/height
    // when the browser happens to render at exactly 1:1 - not guaranteed once
    // OS display scaling, browser zoom, or fractional flex layout widths are
    // involved. Rescale into buffer space before hit-testing, or the hit
    // region drifts from the drawn polygon (worse toward the canvas edges).
    const scaleX = rect.width ? canvas.width / rect.width : 1;
    const scaleY = rect.height ? canvas.height / rect.height : 1;
    const bufferX = cssX * scaleX;
    const bufferY = cssY * scaleY;

    const ctx = canvas.getContext('2d');
    const hit = ctx ? this.shapes.find((shape) => ctx.isPointInPath(shape.path, bufferX, bufferY)) : undefined;
    if (!hit) {
      tooltip.style.display = 'none';
      this.setHighlight(null);
      return;
    }

    this.setHighlight(hit.zone.zoneName);

    tooltip.style.display = 'block';
    tooltip.innerHTML = `
      <div class="tooltip-title"><span class="tooltip-swatch" style="background:${hit.stroke}"></span>${hit.zone.zoneName}</div>
      <div class="tooltip-row"><span>Traffic</span><b>${hit.zone.traffic.toLocaleString('en-US')}</b></div>
      <div class="tooltip-row"><span>Visitors</span><b>${hit.zone.visitorTraffic.toLocaleString('en-US')}</b></div>
      <div class="tooltip-row"><span>Attention Visitors</span><b>${hit.zone.attentionVisitors.toLocaleString('en-US')}</b></div>
      <div class="tooltip-row"><span>Avg Dwell</span><b>${this.formatDuration(hit.zone.avgResidenceTime)}</b></div>
    `;

    // Overflow check must compare against the canvas's displayed CSS size
    // (rect), not its internal buffer size (canvas.width/height) - mixing the
    // two flips/clips the tooltip at the wrong threshold whenever they differ.
    const offset = 12;
    let left = cssX + offset;
    let top = cssY + offset;
    if (left + tooltip.offsetWidth > rect.width) {
      left = cssX - tooltip.offsetWidth - offset;
    }
    if (top + tooltip.offsetHeight > rect.height) {
      top = cssY - tooltip.offsetHeight - offset;
    }
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  private withAlpha(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private formatDuration(seconds: number): string {
    const pad = (v: number) => v.toString().padStart(2, '0');
    const hh = Math.floor(seconds / 3600);
    const mm = Math.floor((seconds % 3600) / 60);
    const ss = Math.floor(seconds % 60);
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }
}
