export function isStoreCountValid(stores: number, min: number | null, max: number | null): boolean {
  return (min === null || stores >= min) && (max === null || stores <= max);
}
