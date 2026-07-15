import http from 'k6/http';
import { sleep, check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const res = http.get('https://certify.dostcaraga.ph/login');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response below 1s': (r) => r.timings.duration < 1000,
  });

  sleep(1);
}