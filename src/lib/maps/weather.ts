import type { Budget } from "../budget";
import { LIMITS, env } from "../config";
import { fetchJson } from "../http";
import type { LatLng } from "../geo";
import type { DayWeather } from "../schema/places";

type ForecastResponse = {
  nextPageToken?: string;
  forecastDays?: Array<{
    displayDate?: { year: number; month: number; day: number };
    maxTemperature?: { degrees?: number };
    minTemperature?: { degrees?: number };
    daytimeForecast?: {
      weatherCondition?: { description?: { text?: string } };
      precipitation?: { probability?: { percent?: number } };
    };
  }>;
};

const iso = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/**
 * Daily forecast, matched to the trip dates.
 *
 * The API only forecasts 10 days out. Rather than silently omitting weather for
 * a trip planned three weeks ahead, dates past the horizon come back with
 * `available: false` so the itinerary can say so honestly instead of guessing.
 */
export async function forecastForDates(
  at: LatLng,
  dates: string[],
  budget: Budget,
): Promise<DayWeather[]> {
  const byDate = new Map<string, DayWeather>();

  try {
    // pageSize defaults to 5 — NOT 10. Without it you silently get half the
    // forecast and days 6-10 look like "no data available this far out", which
    // is a completely different (and wrong) explanation. Max is 10.
    const base =
      `https://weather.googleapis.com/v1/forecast/days:lookup` +
      `?key=${env().GOOGLE_MAPS_API_KEY}` +
      `&location.latitude=${at.lat}&location.longitude=${at.lng}` +
      `&days=${LIMITS.FORECAST_HORIZON_DAYS}` +
      `&pageSize=${LIMITS.FORECAST_HORIZON_DAYS}`;

    let pageToken: string | undefined;
    let pagesFetched = 0;

    // pageSize=10 should return everything in one page, but the API is free to
    // paginate anyway. Follow the token until the requested dates are covered.
    do {
      const data: ForecastResponse = await fetchJson<ForecastResponse>({
        api: "Weather:forecastDays",
        url: pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base,
        budget,
        sku: "weather:daily",
        maxRetries: 1,
      });

      for (const day of data.forecastDays ?? []) {
        if (!day.displayDate) continue;
        byDate.set(iso(day.displayDate), {
          date: iso(day.displayDate),
          summary: day.daytimeForecast?.weatherCondition?.description?.text ?? "Unknown",
          maxC: day.maxTemperature?.degrees,
          minC: day.minTemperature?.degrees,
          precipitationPercent: day.daytimeForecast?.precipitation?.probability?.percent,
          available: true,
        });
      }

      pageToken = data.nextPageToken;
      pagesFetched++;
    } while (pageToken && pagesFetched < 3 && dates.some((d) => !byDate.has(d)));
  } catch {
    // Weather is an enhancement, never a blocker. If the API is unavailable or
    // the region is unsupported, the trip still gets planned without it.
  }

  return dates.map(
    (d) =>
      byDate.get(d) ?? {
        date: d,
        summary: "No forecast available this far out",
        available: false,
      },
  );
}
