/**
 * A pre-simulation reference is a forecast ISSUE, not a property of the storm's
 * hourly observations. Keep it on the live Typhoon (so future forecasts can
 * use it) and on its original issue-hour history node only. Copying it into
 * each subsequent hourly snapshot both corrupts archive validation (issueHour
 * no longer equals the snapshot hour) and multiplies a large 120-hour forecast
 * by the length of the historical record.
 */
export function makeHourlyHistorySeed<T extends {
  history?: unknown;
  preSimulationReference?: unknown;
  preSimulationReferenceCleared?: unknown;
  realisticMotion?: unknown;
}>(typhoon: T): Omit<T, 'history' | 'preSimulationReference' | 'preSimulationReferenceCleared' | 'realisticMotion'> {
  const {
    history: _history,
    preSimulationReference: _forecastIssue,
    preSimulationReferenceCleared: _forecastCleared,
    realisticMotion: _realisticJournal,
    ...observation
  } = typhoon;
  return observation;
}
