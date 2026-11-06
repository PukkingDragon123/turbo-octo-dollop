// Station builders (eyes / rags / hats register themselves; index.js builds them on first visit).
export const STATION_BUILDERS = {};
export function registerStation(key, build) { STATION_BUILDERS[key] = build; }
