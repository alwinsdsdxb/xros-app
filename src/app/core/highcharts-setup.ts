// The bare 'highcharts' package entry is a UMD bundle whose optional
// modules (heatmap, sankey, ...) expect a global `_Highcharts` reference -
// a pattern webpack's `externals` config wires up but esbuild (Angular's
// default builder) does not, so those modules silently fail to register
// under this build. The es-modules/masters tree is Highcharts' own
// pure-ESM entry point: importing a module from it registers series
// directly onto the shared Core/Globals.js singleton via relative
// imports, with no factory-call/global-shim required. Import chart
// modules (heatmap.src, sankey.src, ...) as side effects alongside this.
import Highcharts from 'highcharts/es-modules/masters/highcharts.src';

export default Highcharts;
