#!/bin/bash
set -e

export NODE_ENV=production
export PATH="/home/talinoserver/.nvm/versions/node/v20.20.2/bin:$PATH"

cd /home/talinoserver/Documents/dostcaraga-TARAsense

echo "Starting TARAsense in production mode on port ${PORT:-3000}..."
exec node node_modules/.bin/next start -p "${PORT:-3000}"
