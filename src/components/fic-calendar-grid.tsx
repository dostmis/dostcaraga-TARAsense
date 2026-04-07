'use client';

import { useState, useEffect } from 'react';
import { getFicCalendar, setAvailability, bulkSetAvailability } from '@/lib/services/fic-availability-service';
import type { FicAvailability } from '@/lib/services/fic-availability-service';

interface CalendarGridProps {
  ficUserId: string;
  year: number;
  month: number; // 0-11
}

interface CalendarDay {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  isCurrentMonth: boolean;
  availability: FicAvailability | null;
}

export function CalendarGrid({ ficUserId, year, month }: CalendarGridProps) {
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<'add' | 'remove' | null>(null);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  // Load calendar data
  useEffect(() => {
    loadCalendar();
  }, [ficUserId, year, month]);

  const loadCalendar = async () => {
    setLoading(true);
    setError(null);

    try {
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);

      const availabilityData = await getFicCalendar(
        ficUserId,
        formatDateString(startDate),
        formatDateString(endDate)
      );

      const availabilityMap = new Map(
        availabilityData.map((item) => [item.date, item])
      );

      const days: CalendarDay[] = [];
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startPadding = firstDay.getDay(); // Day of week (0=Sun)

      // Previous month days (padding)
      for (let i = startPadding - 1; i >= 0; i--) {
        const prevDate = new Date(year, month, -i);
        const dateString = formatDateString(prevDate);
        days.push({
          date: dateString,
          dayOfMonth: prevDate.getDate(),
          isCurrentMonth: false,
          availability: availabilityMap.get(dateString) || null,
        });
      }

      // Current month days
      for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const dateString = formatDateString(date);
        days.push({
          date: dateString,
          dayOfMonth: day,
          isCurrentMonth: true,
          availability: availabilityMap.get(dateString) || null,
        });
      }

      // Next month days (filling to 42 cells = 6 rows)
      while (days.length % 7 !== 0) {
        const nextDate = new Date(year, month + 1, days.length - startPadding - lastDay.getDate() + 1);
        const dateString = formatDateString(nextDate);
        days.push({
          date: dateString,
          dayOfMonth: nextDate.getDate(),
          isCurrentMonth: false,
          availability: availabilityMap.get(dateString) || null,
        });
      }

      setCalendarDays(days);
    } catch (err) {
      setError('Failed to load calendar. Please try again.');
      console.error('Error loading calendar:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDateString = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  const handleDayClick = async (date: string, currentStatus: boolean) => {
    if (bulkMode) {
      // Bulk selection mode
      setSelectedDates((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(date)) {
          newSet.delete(date);
        } else {
          newSet.add(date);
        }
        return newSet;
      });
      return;
    }

    // Direct toggle mode
    try {
      const availability = await setAvailability(ficUserId, date, !currentStatus);
      if (availability) {
        // Update local state
        setCalendarDays((prev) =>
          prev.map((day) =>
            day.date === date
              ? { ...day, availability: { ...day.availability!, isAvailable: !currentStatus } }
              : day
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update availability');
      console.error('Error toggling availability:', err);
    }
  };

  const applyBulkChanges = async () => {
    if (!bulkMode || selectedDates.size === 0) return;

    setLoading(true);
    setError(null);

    try {
      const datesToUpdate = Array.from(selectedDates).map((date) => ({
        date,
        isAvailable: bulkMode === 'add',
      }));

      const result = await bulkSetAvailability(ficUserId, datesToUpdate);

      if (result.success) {
        setSelectedDates(new Set());
        setBulkMode(null);
        await loadCalendar(); // Refresh
      } else {
        setError(result.errors?.[0]?.message || 'Failed to update some dates');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
      console.error('Error in bulk update:', err);
    } finally {
      setLoading(false);
    }
  };

  const cancelBulkMode = () => {
    setBulkMode(null);
    setSelectedDates(new Set());
  };

  const getDayStatus = (day: CalendarDay): 'available' | 'unavailable' | 'locked' | 'empty' => {
    if (!day.availability) return 'empty';
    if (day.availability.isLocked) return 'locked';
    return day.availability.isAvailable ? 'available' : 'unavailable';
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading && calendarDays.length === 0) {
    return <div className="text-center py-8 text-gray-500">Loading calendar...</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold text-gray-900">
          {monthNames[month]} {year}
        </h3>
        <div className="flex items-center gap-4">
          {bulkMode && (
            <>
              <span className="text-sm text-gray-600">
                {selectedDates.size} dates selected
              </span>
              <button
                onClick={applyBulkChanges}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Apply Changes
              </button>
              <button
                onClick={cancelBulkMode}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-6 mb-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 border-2 border-green-500 rounded"></div>
          <span>Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-100 border-2 border-gray-400 rounded"></div>
          <span>Unavailable</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-100 border-2 border-red-500 rounded flex items-center justify-center">
            <span className="text-xs">🔒</span>
          </div>
          <span>Booked (Locked)</span>
        </div>
      </div>

      {/* Bulk Mode Toggle */}
      {!bulkMode && (
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setBulkMode('add')}
            className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded hover:bg-green-200 transition-colors"
          >
            Bulk Add Available Dates
          </button>
          <button
            onClick={() => setBulkMode('remove')}
            className="px-3 py-1 bg-red-100 text-red-700 text-sm font-medium rounded hover:bg-red-200 transition-colors"
          >
            Bulk Remove Available Dates
          </button>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Day Headers */}
        {dayHeaders.map((header) => (
          <div key={header} className="py-2 text-center text-xs font-semibold text-gray-500 uppercase">
            {header}
          </div>
        ))}

        {/* Days */}
        {calendarDays.map((day, index) => {
          const status = getDayStatus(day);
          const isSelected = selectedDates.has(day.date);
          
          const baseClasses = "aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-all cursor-pointer relative";
          const statusClasses = {
            available: "bg-green-100 border-2 border-green-500 text-green-700 hover:bg-green-200",
            unavailable: "bg-gray-100 border-2 border-gray-300 text-gray-500 hover:bg-gray-200",
            locked: "bg-red-100 border-2 border-red-500 text-red-700 cursor-not-allowed",
            empty: "bg-white border-2 border-transparent text-gray-400",
          };

          return (
            <div
              key={day.date}
              onClick={() => {
                if (status !== 'locked') {
                  handleDayClick(day.date, day.availability?.isAvailable || false);
                }
              }}
              className={`
                ${baseClasses}
                ${statusClasses[status]}
                ${!day.isCurrentMonth ? 'opacity-30' : ''}
                ${isSelected ? 'ring-2 ring-blue-500' : ''}
                ${bulkMode && status !== 'locked' ? 'cursor-pointer' : ''}
              `}
            >
              <span className="font-medium">{day.dayOfMonth}</span>
              {status === 'locked' && (
                <span className="text-xs mt-1">🔒</span>
              )}
              {status === 'available' && (
                <span className="text-xs mt-1 text-green-600">✓</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Instructions */}
      {bulkMode ? (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Bulk Mode:</strong> Click dates to select/deselect them, then click "Apply Changes" to update all selected dates at once.
          </p>
        </div>
      ) : (
        <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-sm text-gray-600">
            <strong>Click any date</strong> to toggle availability. Green = available, Gray = unavailable. Red/locked dates cannot be edited (already booked).
          </p>
        </div>
      )}
    </div>
  );
}
