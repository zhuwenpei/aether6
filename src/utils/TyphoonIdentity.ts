import type { Typhoon, TyphoonState } from "../types";

/**
 * Merge an archived/forecast state onto a cyclone without allowing stale identity fields stored in
 * old snapshots to overwrite the live identity edited by the user.
 */
export function mergeTyphoonStateWithCurrentIdentity(
  typhoon: Typhoon,
  state?: Partial<TyphoonState> | Partial<Typhoon> | null,
  extra?: Partial<Typhoon>
): Typhoon {
  return {
    ...typhoon,
    ...(state || {}),
    ...(extra || {}),
    id: typhoon.id,
    name: typhoon.name,
    officialNumber: typhoon.officialNumber,
    seasonOrdinal: typhoon.seasonOrdinal
  } as Typhoon;
}

/** Keep legacy snapshots from carrying an old storm name into products that hydrate from history. */
export function syncTyphoonNameIntoSnapshots(typhoon: Typhoon, name: string): Typhoon {
  const history = typhoon.history || [];
  const historyNeedsRewrite = history.some((state: any) => Object.prototype.hasOwnProperty.call(state, "name") && state.name !== name);
  const forecastPath = typhoon.forecastPath;
  const forecastNeedsRewrite = !!forecastPath?.some((point: any) => Object.prototype.hasOwnProperty.call(point, "name") && point.name !== name);
  return {
    ...typhoon,
    name,
    history: historyNeedsRewrite
      ? history.map((state) => ({ ...(state as any), name }) as TyphoonState)
      : history,
    forecastPath: forecastNeedsRewrite
      ? forecastPath!.map((point: any) => ({ ...point, name }))
      : forecastPath
  };
}
