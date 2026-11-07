/**
 * Time-of-day and weather choices. Kept free of three.js so the start screen
 * can list them without pulling the renderer into the initial bundle.
 */
export type TimeOfDay = 'day' | 'evening' | 'night';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog';

export interface DrivingConditions {
  timeOfDay: TimeOfDay;
  weather: Weather;
}

export const TIME_OF_DAY_OPTIONS: readonly { id: TimeOfDay; label: string }[] = [
  { id: 'day', label: 'DAY' },
  { id: 'evening', label: 'EVENING' },
  { id: 'night', label: 'NIGHT' },
];

export const WEATHER_OPTIONS: readonly { id: Weather; label: string }[] = [
  { id: 'clear', label: 'CLEAR' },
  { id: 'cloudy', label: 'CLOUDY' },
  { id: 'rain', label: 'RAIN' },
  { id: 'fog', label: 'FOG' },
];

export const DEFAULT_CONDITIONS: Readonly<DrivingConditions> = {
  timeOfDay: 'day',
  weather: 'clear',
};

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return TIME_OF_DAY_OPTIONS.some((option) => option.id === value);
}

export function isWeather(value: unknown): value is Weather {
  return WEATHER_OPTIONS.some((option) => option.id === value);
}
