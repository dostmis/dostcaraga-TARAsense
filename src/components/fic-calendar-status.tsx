'use client';

import { useEffect } from 'react';

export function FicCalendarStatus() {
  useEffect(() => {
    // Check if API is accessible
    const checkApi = async () => {
      try {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
        const response = await fetch(`${API_BASE_URL}/health`, {
          method: 'GET',
          credentials: 'include',
        });
        
        if (response.ok) {
          console.log('✅ API is accessible at:', API_BASE_URL);
        } else {
          console.warn('⚠️ API returned non-OK status:', response.status);
        }
      } catch (error) {
        console.error('❌ API is not accessible:', error);
        console.error('Please ensure:');
        console.error('1. API server is running (npm run dev in api folder)');
        console.error('2. API is on port 4000');
        console.error('3. CORS is enabled in main.ts');
        console.error('4. NEXT_PUBLIC_API_URL is set in .env');
      }
    };
    
    checkApi();
  }, []);
  
  return null;
}
