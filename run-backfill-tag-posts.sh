#!/bin/bash

# Script to run backfill-tag-posts.js with PM2 environment variables
# Usage: ./run-backfill-tag-posts.sh

echo "🔍 Extracting database credentials from PM2..."
echo ""

# Extract POSTGRES variables from PM2 process 3 (nina-api)
export POSTGRES_HOST=$(pm2 env 3 | grep "POSTGRES_HOST:" | awk '{print $2}')
export POSTGRES_DATABASE=$(pm2 env 3 | grep "POSTGRES_DATABASE:" | awk '{print $2}')
export POSTGRES_USER=$(pm2 env 3 | grep "POSTGRES_USER:" | awk '{print $2}')
export POSTGRES_PASSWORD=$(pm2 env 3 | grep "POSTGRES_PASSWORD:" | awk '{print $2}')

echo "📋 Environment Configuration:"
echo "============================================================"
echo "   POSTGRES_HOST: ${POSTGRES_HOST}"
echo "   POSTGRES_DATABASE: ${POSTGRES_DATABASE}"
echo "   POSTGRES_USER: ${POSTGRES_USER}"
echo "   POSTGRES_PASSWORD: $(echo $POSTGRES_PASSWORD | sed 's/./*/g')"
echo "============================================================"
echo ""

# Verify all variables are set
if [ -z "$POSTGRES_HOST" ] || [ -z "$POSTGRES_DATABASE" ] || [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ]; then
    echo "❌ ERROR: Failed to extract database credentials from PM2"
    echo "   Please check that PM2 process 3 (nina-api) is running"
    exit 1
fi

echo "✅ Credentials extracted successfully"
echo ""
echo "🚀 Running backfill script..."
echo ""

# Run the backfill script
node backfill-tag-posts.js

# Capture exit code
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Backfill completed successfully"
else
    echo "❌ Backfill failed with exit code: $EXIT_CODE"
fi

exit $EXIT_CODE
