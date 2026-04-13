'use client';

import { useState } from 'react';
import { CalendarGrid } from '@/components/fic-calendar-grid';
import { FicCalendarControls } from '@/components/fic-calendar-controls';

interface FicAvailabilityCalendarProps {
  ficUserId: string;
}

export function FicAvailabilityCalendar({ ficUserId }: FicAvailabilityCalendarProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [refreshKey, setRefreshKey] = useState(0);

  const handleMonthChange = (newYear: number, newMonth: number) => {
    setYear(newYear);
    setMonth(newMonth);
  };

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-6">
      {/* Calendar Controls */}
      <FicCalendarControls
        ficUserId={ficUserId}
        year={year}
        month={month}
        onMonthChange={handleMonthChange}
        onRefresh={handleRefresh}
      />

      {/* Main Calendar Grid */}
      <CalendarGrid
        key={refreshKey}
        ficUserId={ficUserId}
        year={year}
        month={month}
      />

      {/* Info Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">How to use your FIC Calendar:</h4>
        <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li><strong>Click any date</strong> to toggle availability (Green = available, Gray = unavailable)</li>
          <li><strong>Red/locked dates</strong> are booked by studies and cannot be edited</li>
          <li><strong>Bulk Actions:</strong> Use &quot;Quick Actions&quot; to mark multiple dates at once</li>
          <li><strong>Navigation:</strong> Click Previous/Next to browse different months</li>
          <li><strong>MSMEs can see</strong> your available dates when booking studies</li>
        </ul>
      </div>
    </div>
  );
}
