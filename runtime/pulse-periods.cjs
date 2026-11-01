'use strict';

// Rolling windows computed from the current Europe/Brussels calendar day.
// Keep the IDs stable across midnight, months, years and daylight-saving time.
const PULSE_PERIODS = Object.freeze([
  Object.freeze({ key: 'last7', label: '7 derniers jours', title: '7 jours' }),
  Object.freeze({ key: 'last30', label: '30 derniers jours', title: '30 jours' }),
  Object.freeze({ key: 'next7', label: '7 prochains jours', title: 'À venir' })
]);

module.exports = { PULSE_PERIODS };
