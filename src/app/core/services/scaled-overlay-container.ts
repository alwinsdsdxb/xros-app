import { Injectable } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';

// Relocates every CDK overlay panel (mat-select, mat-datepicker, mat-menu,
// tooltips, autocomplete) to render inside <app-root> instead of CDK's own
// default of document.body. <app-root> carries this app's desktop
// `transform: scale(0.8)` density adjustment (see app.component.scss) -
// appending overlays as its child keeps their position math (which compares
// the trigger's, the overlay container's, and the viewport's
// getBoundingClientRect()s) and their visual scale both consistent with the
// element that opened them. The old `zoom`-based approach didn't have this
// service and left overlays parented to the untransformed document.body,
// which under `zoom` desynced those rects - see styles.scss for the
// upstream CDK bug this replaces.
@Injectable()
export class ScaledOverlayContainer extends OverlayContainer {
  protected override _createContainer(): void {
    const container = this._document.createElement('div');
    container.classList.add('cdk-overlay-container');
    const host = this._document.querySelector('app-root') ?? this._document.body;
    host.appendChild(container);
    this._containerElement = container;
  }
}
