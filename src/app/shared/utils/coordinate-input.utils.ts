export interface CoordinateValidationResult {
  latitudeError: string | null;
  longitudeError: string | null;
  hasErrors: boolean;
}

export function parseCoordinateInput(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  // Decimal-only (rejects hex/binary/octal prefixes and exponent notation).
  if (!/^[+-]?(?:\d+|\d*\.\d+)$/.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateCoordinatePair(
  latitudeRaw: string,
  longitudeRaw: string
): CoordinateValidationResult {
  const latitudeText = latitudeRaw.trim();
  const longitudeText = longitudeRaw.trim();
  const latitudeProvided = latitudeText.length > 0;
  const longitudeProvided = longitudeText.length > 0;

  if (!latitudeProvided && !longitudeProvided) {
    return { latitudeError: null, longitudeError: null, hasErrors: false };
  }

  let latitudeError: string | null = null;
  let longitudeError: string | null = null;

  if (latitudeProvided && !longitudeProvided) {
    longitudeError = 'Longitude is required when latitude is set.';
  }
  if (!latitudeProvided && longitudeProvided) {
    latitudeError = 'Latitude is required when longitude is set.';
  }

  const latitude = parseCoordinateInput(latitudeText);
  const longitude = parseCoordinateInput(longitudeText);

  if (latitudeProvided && latitude == null) {
    latitudeError = 'Latitude must be a valid number.';
  }
  if (longitudeProvided && longitude == null) {
    longitudeError = 'Longitude must be a valid number.';
  }

  if (latitude != null && (latitude < -90 || latitude > 90)) {
    latitudeError = 'Latitude must be between -90 and 90.';
  }
  if (longitude != null && (longitude < -180 || longitude > 180)) {
    longitudeError = 'Longitude must be between -180 and 180.';
  }

  return {
    latitudeError,
    longitudeError,
    hasErrors: !!latitudeError || !!longitudeError,
  };
}
