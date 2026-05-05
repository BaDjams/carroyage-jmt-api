#!/bin/bash
# Example: generate a CADO KMZ via curl

curl -X POST http://localhost:3000/api/kmz/cado \
  -H "Content-Type: application/json" \
  -d @examples/request.json \
  --output mission-paris.kmz

echo ""
echo "KMZ saved to mission-paris.kmz"
ls -lh mission-paris.kmz
