export type CarModelId = 'ford-f150-raptor' | 'ford-everest-sport' | 'ioniq-5' | 'luxury-concept';

export const DEFAULT_CAR_MODEL_ID: CarModelId = 'luxury-concept';

export const CAR_MODEL_OPTIONS: readonly { id: CarModelId; label: string }[] = [
  { id: 'ford-f150-raptor', label: '2017 Ford F-150 Raptor' },
  { id: 'ford-everest-sport', label: '2023 Ford Everest Sport' },
  { id: 'ioniq-5', label: 'Hyundai Ioniq 5' },
  { id: 'luxury-concept', label: '2018 Audi e-tron GT Concept' },
];

export const CAR_MODEL_VARIETY_OPTIONS = [1, 2, 3, 4] as const;

export function selectCarModelIds(playerModelId: CarModelId, requestedCount: number): CarModelId[] {
  const modelIds = CAR_MODEL_OPTIONS.map(({ id }) => id);
  const start = Math.max(0, modelIds.indexOf(playerModelId));
  const normalizedCount = Number.isFinite(requestedCount) ? Math.round(requestedCount) : 1;
  const count = Math.max(1, Math.min(modelIds.length, normalizedCount));
  return Array.from({ length: count }, (_, offset) => modelIds[(start + offset) % modelIds.length]);
}
