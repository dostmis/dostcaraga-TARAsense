'use client';

import { useEffect } from 'react';
import { buildApiUrl } from "@/lib/api-config";

export function FicCalendarStatus() {
  useEffect(() => {
    // Check if API is accessible
    const checkApi = async () => {
      try {
        const response = await fetch(buildApiUrl('/fic-availability/available-fics?startDate=2026-01-01&endDate=2026-01-02'), {
          method: 'GET',
          credentials: 'include',
        });
        
        if (response.ok) {
          console.log('✅ FIC API is accessible');
        } else {
          console.warn('⚠️ API returned non-OK status:', response.status);
        }
      } catch (error) {
        console.error('❌ API is not accessible:', error);
        console.error('Please ensure the Next.js server is running and DB is reachable.');
      }
    };
    
    checkApi();
  }, []);
  
  return null;
}
