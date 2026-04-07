'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL } from "@/lib/api-config";

interface ConnectionStatus {
  apiUrl: string;
  isReachable: boolean;
  error?: string;
  timestamp: string;
}

export function FicCalendarConnectionTest() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    // Test connection on mount
    testConnection();
  }, []);

  const testConnection = async () => {
    setIsTesting(true);
    
    try {
      console.log('='.repeat(60));
      console.log('🔍 Testing API Connection...');
      console.log('API_BASE_URL:', API_BASE_URL);
      console.log('Window location:', window.location.origin);
      console.log('='.repeat(60));

      // Test 1: Basic connectivity
      const testUrl = `${API_BASE_URL}/health`;
      console.log('Testing:', testUrl);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(testUrl, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const result: ConnectionStatus = {
        apiUrl: API_BASE_URL,
        isReachable: response.ok,
        timestamp: new Date().toISOString(),
      };
      
      if (!response.ok) {
        result.error = `HTTP ${response.status}: ${response.statusText}`;
      }
      
      setStatus(result);
      
      console.log('✅ API Connection Test Result:', result);
      
      if (response.ok) {
        console.log('🎉 API is reachable!');
      } else {
        console.error('❌ API returned error:', result.error);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const result: ConnectionStatus = {
        apiUrl: API_BASE_URL,
        isReachable: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };
      
      setStatus(result);
      
      console.error('❌ API Connection Failed:', errorMessage);
      console.error('💡 Common causes:');
      console.error('   1. API server not running (npm run dev in api folder)');
      console.error('   2. API server on wrong port (should be 4000)');
      console.error('   3. CORS not enabled in main.ts');
      console.error('   4. NEXT_PUBLIC_API_URL not set in .env');
      console.error('   5. Firewall blocking port 4000');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <h4 className="font-semibold text-sm mb-2">🔧 API Connection Status</h4>
      
      {isTesting ? (
        <div className="text-sm text-gray-600">⏳ Testing connection...</div>
      ) : status ? (
        <div className="space-y-2 text-sm">
          <div>
            <strong>API URL:</strong> <code className="bg-gray-200 px-1 rounded">{status.apiUrl}</code>
          </div>
          
          {status.isReachable ? (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              <span className="text-green-700 font-medium">✅ Connected</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                <span className="text-red-700 font-medium">❌ Not Connected</span>
              </div>
              {status.error && (
                <div className="text-red-600 bg-red-50 p-2 rounded border border-red-200">
                  <strong>Error:</strong> {status.error}
                </div>
              )}
              <div className="text-red-700 text-xs space-y-1">
                <p><strong>Please check:</strong></p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li>API server running on port 4000</li>
                  <li>CORS enabled in api/src/main.ts</li>
                  <li>.env has NEXT_PUBLIC_API_URL</li>
                  <li>No firewall blocking port 4000</li>
                </ul>
              </div>
              <button
                onClick={testConnection}
                className="mt-2 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
              >
                Retry Connection Test
              </button>
            </>
          )}
          
          <div className="text-xs text-gray-500">
            Last checked: {new Date(status.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-500">Initializing...</div>
      )}
    </div>
  );
}
