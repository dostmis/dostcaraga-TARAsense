'use client';

import { useState } from 'react';
import { bulkSetAvailability } from '@/lib/services/fic-availability-service';
import { formatLocalDateKey } from '@/lib/date-time';

interface FicCalendarControlsProps {
  ficUserId: string;
  year: number;
  month: number; // 0-11
  onMonthChange: (year: number, month: number) => void;
  onRefresh: () => void;
}

export function FicCalendarControls({
  ficUserId,
  year,
  month,
  onMonthChange,
  onRefresh,
}: FicCalendarControlsProps) {
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handlePreviousMonth = () => {
    const newMonth = month === 0 ? 11 : month - 1;
    const newYear = month === 0 ? year - 1 : year;
    onMonthChange(newYear, newMonth);
  };

  const handleNextMonth = () => {
    const newMonth = month === 11 ? 0 : month + 1;
    const newYear = month === 11 ? year + 1 : year;
    onMonthChange(newYear, newMonth);
  };

  const handleMarkWeekdays = async () => {
    if (!confirm('Mark all weekdays (Mon-Fri) in this month as available?')) return;

    setWorking(true);
    setStatus(null);

    try {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const dates = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat

        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          dates.push({
            date: formatLocalDateKey(date),
            isAvailable: true,
          });
        }
      }

      const result = await bulkSetAvailability(ficUserId, dates);

      if (result.success) {
        setStatus({ type: 'success', message: `Marked ${dates.length} weekdays as available!` });
        onRefresh();
      } else {
        setStatus({ type: 'error', message: result.errors?.[0]?.message || 'Some dates failed to update' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to mark weekdays' });
    } finally {
      setWorking(false);
    }
  };

  const handleMarkWeekends = async () => {
    if (!confirm('Mark all weekends (Sat-Sun) in this month as available?')) return;

    setWorking(true);
    setStatus(null);

    try {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const dates = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dayOfWeek = date.getDay();

        if (dayOfWeek === 0 || dayOfWeek === 6) {
          dates.push({
            date: formatLocalDateKey(date),
            isAvailable: true,
          });
        }
      }

      const result = await bulkSetAvailability(ficUserId, dates);

      if (result.success) {
        setStatus({ type: 'success', message: `Marked ${dates.length} weekend days as available!` });
        onRefresh();
      } else {
        setStatus({ type: 'error', message: result.errors?.[0]?.message || 'Some dates failed to update' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to mark weekends' });
    } finally {
      setWorking(false);
    }
  };

  const handleClearMonth = async () => {
    if (!confirm('Clear all available dates in this month? This will only remove availability, not booked dates.')) return;

    setWorking(true);
    setStatus(null);

    try {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const dates = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        dates.push({
          date: formatLocalDateKey(date),
          isAvailable: false,
        });
      }

      const result = await bulkSetAvailability(ficUserId, dates);

      if (result.success) {
        setStatus({ type: 'success', message: `Cleared availability for ${daysInMonth} days!` });
        onRefresh();
      } else {
        setStatus({ type: 'error', message: result.errors?.[0]?.message || 'Some dates failed to update' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to clear month' });
    } finally {
      setWorking(false);
    }
  };

  const handleRefresh = () => {
    onRefresh();
    setStatus({ type: 'success', message: 'Calendar refreshed!' });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePreviousMonth}
            disabled={working}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:opacity-50 rounded-lg text-gray-700 font-medium transition-colors"
          >
            ← Previous
          </button>
          <div className="px-4 py-2 bg-blue-50 rounded-lg">
            <span className="text-blue-900 font-semibold text-lg">
              {monthNames[month]} {year}
            </span>
          </div>
          <button
            onClick={handleNextMonth}
            disabled={working}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:opacity-50 rounded-lg text-gray-700 font-medium transition-colors"
          >
            Next →
          </button>
        </div>

        {/* Bulk Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600 mr-2">Quick Actions:</span>
          <button
            onClick={handleMarkWeekdays}
            disabled={working}
            className="px-3 py-1 bg-green-100 hover:bg-green-200 disabled:opacity-50 text-green-700 text-sm font-medium rounded transition-colors"
          >
            Mark All Weekdays
          </button>
          <button
            onClick={handleMarkWeekends}
            disabled={working}
            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 disabled:opacity-50 text-blue-700 text-sm font-medium rounded transition-colors"
          >
            Mark All Weekends
          </button>
          <button
            onClick={handleClearMonth}
            disabled={working}
            className="px-3 py-1 bg-red-100 hover:bg-red-200 disabled:opacity-50 text-red-700 text-sm font-medium rounded transition-colors"
          >
            Clear Month
          </button>
          <button
            onClick={handleRefresh}
            disabled={working}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-medium rounded transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Status */}
      {status?.type === 'success' && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          ✓ {status.message}
        </div>
      )}
      {status?.type === 'error' && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          ✗ {status.message}
        </div>
      )}

      {working && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm">
          Working...
        </div>
      )}
    </div>
  );
}
