// Client-side service for FIC availability integration
import { FACILITIES_BY_REGION } from "@/lib/facility-constants";
import { buildApiUrl } from "@/lib/api-config";

/** Custom error class for API errors */
class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public statusText?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Make API request with enhanced error handling */
async function makeApiRequest(url: string, options: RequestInit = {}) {
  const requestUrl = buildApiUrl(url);

  try {
    // Ensure credentials are always included for auth
    const fetchOptions = {
      ...options,
      credentials: 'include' as RequestCredentials,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const response = await fetch(requestUrl, fetchOptions);
    
    // Handle non-OK responses
    if (!response.ok) {
      const errorData = await response.text().catch(() => "No error details");
      throw new ApiError(
        `API Error: ${response.status} ${response.statusText}. ${errorData}`,
        response.status,
        response.statusText
      );
    }

    return response;
  } catch (error) {
    // Network error or CORS error
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new ApiError(
        `Failed to connect to the calendar service. Please refresh and try again.`
      );
    }
    
    // Re-throw other errors
    throw error;
  }
}

export interface FicAvailability {
  id: string;
  ficUserId: string;
  date: string;
  isAvailable: boolean;
  isLocked: boolean;
  lockedById?: string;
  lockedAt?: string;
}

export interface AvailableFic {
  id: string;
  name: string;
  email: string;
  organization?: string;
  assignedRegion?: string | null;
  assignedFacility?: string | null;
  availableDates: string[];
  availabilityPercentage: number;
}

export interface FacilityAssignedFic {
  id: string;
  name: string;
  email: string;
  organization?: string;
  assignedRegion?: string | null;
  assignedFacility?: string | null;
  availableDateCount: number;
  availabilityPercentage: number;
}

export interface FacilityAvailabilityByDate {
  date: string;
  availableFicCount: number;
  totalAssignedFicCount: number;
}

export interface FacilityAvailabilityOverview {
  startDate: string;
  endDate: string;
  region?: string | null;
  facility?: string | null;
  totalAssignedFicCount: number;
  assignedFics: FacilityAssignedFic[];
  availableFics: AvailableFic[];
  availabilityByDate: FacilityAvailabilityByDate[];
  ficAvailabilityByUser: Array<{
    ficUserId: string;
    availableDates: string[];
  }>;
}

export interface BulkAvailabilityError {
  message: string;
}

export interface BulkAvailabilityResult {
  success: boolean;
  results?: Array<Record<string, unknown>>;
  errors?: BulkAvailabilityError[];
}

type SessionSlotLike = {
  startDateTime?: string | Date | null;
};

/**
 * Get available FICs for a date range and facility
 */
export async function getAvailableFics(
  startDate: string,
  endDate: string,
  region?: string,
  facility?: string
): Promise<AvailableFic[]> {
  try {
    const params = new URLSearchParams({
      startDate,
      endDate,
    });

    if (region) {
      params.append('region', region);
    }
    
    if (facility) {
      params.append('facility', facility);
    }

    const response = await makeApiRequest(
      `/fic-availability/available-fics?${params.toString()}`
    );

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching available FICs:', error);

    return [];
  }
}

/**
 * Get facility-level FIC overview (assigned users + per-date capacity).
 */
export async function getFacilityAvailabilityOverview(
  startDate: string,
  endDate: string,
  region: string,
  facility: string
): Promise<FacilityAvailabilityOverview | null> {
  try {
    if (!region || !facility) {
      return null;
    }

    const params = new URLSearchParams({
      startDate,
      endDate,
      region,
      facility,
      includeOverview: "1",
    });

    const response = await makeApiRequest(
      `/fic-availability/available-fics?${params.toString()}`
    );

    return await response.json();
  } catch (error) {
    console.error('Error fetching facility availability overview:', error);
    return null;
  }
}

/**
 * Get FIC calendar for a specific FIC user
 */
export async function getFicCalendar(
  ficUserId: string,
  startDate: string,
  endDate: string
): Promise<FicAvailability[]> {
  try {
    const params = new URLSearchParams({
      startDate,
      endDate,
    });

    const response = await makeApiRequest(`/fic-availability/calendar/${ficUserId}?${params.toString()}`);

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching FIC calendar:', error);
    throw new Error(getErrorMessage(error));
  }
}

/**
 * Bulk set availability for multiple dates
 */
export async function bulkSetAvailability(
  ficUserId: string,
  dates: { date: string; isAvailable: boolean }[]
): Promise<BulkAvailabilityResult> {
  try {
    const response = await makeApiRequest(
      `/fic-availability/bulk?ficUserId=${ficUserId}`,
      {
        method: 'POST',
        body: JSON.stringify({ dates }),
      }
    );

    return await response.json();
  } catch (error) {
    console.error('Error setting availability:', error);

    return {
      success: false,
      errors: [{ message: getErrorMessage(error) }],
    };
  }
}

/**
 * Toggle availability for a single date
 */
export async function setAvailability(
  ficUserId: string,
  date: string,
  isAvailable: boolean
): Promise<FicAvailability | null> {
  try {
    const response = await makeApiRequest(
      `/fic-availability/${ficUserId}/${date}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable }),
      }
    );

    return await response.json();
  } catch (error) {
    console.error('Error toggling availability:', error);
    throw new Error(getErrorMessage(error));
  }
}

/**
 * Extract dates from study session slots
 */
export function extractDatesFromSessions(sessions: SessionSlotLike[]): string[] {
  const dates = new Set<string>();
  
  for (const session of sessions) {
    if (session.startDateTime) {
      const date = formatDateKey(new Date(session.startDateTime));
      dates.add(date);
    }
  }
  
  return Array.from(dates).sort();
}

/**
 * Check if dates are available for booking
 */
export async function checkDatesAvailability(
  ficUserId: string,
  dates: string[]
): Promise<{ available: boolean; lockedDates?: string[] }> {
  try {
    const calendar = await getFicCalendar(ficUserId, dates[0], dates[dates.length - 1]);
    const lockedDates = calendar
      .filter(a => dates.includes(a.date) && a.isLocked)
      .map(a => a.date);

    return {
      available: lockedDates.length === 0,
      lockedDates: lockedDates.length > 0 ? lockedDates : undefined,
    };
  } catch (error) {
    console.error('Error checking dates availability:', error);
    return { available: false };
  }
}

/**
 * Get FICs by region
 */
export function getFicsByRegion(region: keyof typeof FACILITIES_BY_REGION): readonly string[] {
  return FACILITIES_BY_REGION[region] || [];
}

/**
 * Format date for display (MM/DD/YYYY)
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

/**
 * Get current month range
 */
export function getCurrentMonthRange(): { startDate: string; endDate: string } {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    startDate: formatDateKey(startOfMonth),
    endDate: formatDateKey(endOfMonth),
  };
}

/**
 * Get next 6 months
 */
export function getNextSixMonths(): string[] {
  const months = [];
  const today = new Date();
  
  for (let i = 0; i < 6; i++) {
    const month = new Date(today.getFullYear(), today.getMonth() + i, 1);
    months.push(formatMonthKey(month));
  }
  
  return months;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
