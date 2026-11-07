import { DEFAULT_CONDITIONS, isTimeOfDay, isWeather } from '../game/conditionsCatalog';
import type { DrivingConditions } from '../game/conditionsCatalog';
import { byId } from './dom';

const TIME_OF_DAY_KEY = 'hands-on-highway-time-of-day';
const WEATHER_KEY = 'hands-on-highway-weather';

/**
 * Owns the time-of-day and weather pickers. The start screen and the graphics
 * drawer each show a pair; both stay in sync and the choice is saved locally.
 */
export class ConditionsSettings {
  private readonly timeOfDaySelects = [
    byId<HTMLSelectElement>('time-of-day'),
    byId<HTMLSelectElement>('settings-time-of-day'),
  ];
  private readonly weatherSelects = [
    byId<HTMLSelectElement>('weather'),
    byId<HTMLSelectElement>('settings-weather'),
  ];
  private conditions = this.load();

  constructor() {
    this.syncSelects();
  }

  bind(onChange: (conditions: DrivingConditions) => void, signal: AbortSignal): void {
    for (const select of this.timeOfDaySelects) {
      select.addEventListener(
        'change',
        () => {
          if (!isTimeOfDay(select.value)) return;
          this.update({ ...this.conditions, timeOfDay: select.value }, onChange);
        },
        { signal },
      );
    }
    for (const select of this.weatherSelects) {
      select.addEventListener(
        'change',
        () => {
          if (!isWeather(select.value)) return;
          this.update({ ...this.conditions, weather: select.value }, onChange);
        },
        { signal },
      );
    }
  }

  get(): DrivingConditions {
    return { ...this.conditions };
  }

  private update(
    conditions: DrivingConditions,
    onChange: (conditions: DrivingConditions) => void,
  ): void {
    this.conditions = conditions;
    this.syncSelects();
    this.save();
    onChange(this.get());
  }

  private syncSelects(): void {
    for (const select of this.timeOfDaySelects) select.value = this.conditions.timeOfDay;
    for (const select of this.weatherSelects) select.value = this.conditions.weather;
  }

  private load(): DrivingConditions {
    try {
      const timeOfDay = window.localStorage.getItem(TIME_OF_DAY_KEY);
      const weather = window.localStorage.getItem(WEATHER_KEY);
      return {
        timeOfDay: isTimeOfDay(timeOfDay) ? timeOfDay : DEFAULT_CONDITIONS.timeOfDay,
        weather: isWeather(weather) ? weather : DEFAULT_CONDITIONS.weather,
      };
    } catch {
      return { ...DEFAULT_CONDITIONS };
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(TIME_OF_DAY_KEY, this.conditions.timeOfDay);
      window.localStorage.setItem(WEATHER_KEY, this.conditions.weather);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
}
