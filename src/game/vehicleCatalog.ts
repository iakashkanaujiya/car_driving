export type CarModelId =
  | 'luxury-concept'
  | 'volvo-v60-polestar'
  | 'jaguar-xj-sport'
  | 'peugeot-3008'
  | 'nissan-z-proto'
  | 'nissan-skyline-r34'
  | 'mercedes-c63-amg'
  | 'bmw-7-series'
  | 'bmw-i8'
  | 'maybach-vision-6'
  | 'generic-sedan'
  | 'generic-wagon'
  | 'generic-hatchback'
  | 'generic-compact'
  | 'generic-coupe'
  | 'generic-sport'
  | 'generic-minivan'
  | 'generic-suv'
  | 'generic-offroad'
  | 'generic-pickup';

export const DEFAULT_CAR_MODEL_ID: CarModelId = 'luxury-concept';

export interface CarModelOption {
  id: CarModelId;
  label: string;
  /** Selector heading the car is listed under. */
  group: 'Cars' | 'Generic cars';
}

export const CAR_MODEL_OPTIONS: readonly CarModelOption[] = [
  { id: 'luxury-concept', label: '2018 Audi e-tron GT Concept', group: 'Cars' },
  { id: 'volvo-v60-polestar', label: '2013 Volvo V60 Polestar', group: 'Cars' },
  { id: 'jaguar-xj-sport', label: '2000 Jaguar XJ Sport', group: 'Cars' },
  { id: 'peugeot-3008', label: 'Peugeot 3008', group: 'Cars' },
  { id: 'nissan-z-proto', label: 'Nissan Z Proto', group: 'Cars' },
  { id: 'nissan-skyline-r34', label: 'Nissan Skyline R34 GT-R', group: 'Cars' },
  { id: 'mercedes-c63-amg', label: 'Mercedes-Benz C63 AMG', group: 'Cars' },
  { id: 'bmw-7-series', label: 'BMW 7 Series (F01)', group: 'Cars' },
  { id: 'bmw-i8', label: 'BMW i8', group: 'Cars' },
  { id: 'maybach-vision-6', label: 'Mercedes-Maybach Vision 6', group: 'Cars' },
  { id: 'generic-sedan', label: 'Sedan', group: 'Generic cars' },
  { id: 'generic-wagon', label: 'Wagon', group: 'Generic cars' },
  { id: 'generic-hatchback', label: 'Hatchback', group: 'Generic cars' },
  { id: 'generic-compact', label: 'Compact', group: 'Generic cars' },
  { id: 'generic-coupe', label: 'Coupé', group: 'Generic cars' },
  { id: 'generic-sport', label: 'Sports car', group: 'Generic cars' },
  { id: 'generic-minivan', label: 'Minivan', group: 'Generic cars' },
  { id: 'generic-suv', label: 'SUV', group: 'Generic cars' },
  { id: 'generic-offroad', label: 'Off-roader', group: 'Generic cars' },
  { id: 'generic-pickup', label: 'Pickup', group: 'Generic cars' },
];

export const CAR_MODEL_VARIETY_OPTIONS = [1, 2, 3, 4, 6, 8] as const;

export function selectCarModelIds(playerModelId: CarModelId, requestedCount: number): CarModelId[] {
  const modelIds = CAR_MODEL_OPTIONS.map(({ id }) => id);
  const start = Math.max(0, modelIds.indexOf(playerModelId));
  const normalizedCount = Number.isFinite(requestedCount) ? Math.round(requestedCount) : 1;
  const count = Math.max(1, Math.min(modelIds.length, normalizedCount));
  return Array.from({ length: count }, (_, offset) => modelIds[(start + offset) % modelIds.length]);
}
