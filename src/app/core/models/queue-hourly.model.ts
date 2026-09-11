export interface HourlyQueueRow {
  hour: number;
  hourLabel: string;
  queueCount: number;
  avgQueueLength: number;
  avgQueueSecond: number;
  avgServiceSecond: number;
  abandonTimes: number;
  serviceCount: number;
}

// One row from Vion's own /plaza/list (their term for a mall/store site) -
// used to let a store be manually matched to its real plazaUnid when the
// backend's own externalId field was never populated for it.
export interface VionPlaza {
  plazaUnid: string;
  plazaName: string;
  cityName: string;
}
