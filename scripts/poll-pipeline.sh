#!/bin/bash
# Poll & auto-chain remaining steps for a drama
BASE="http://localhost:8000"
COOKIE="/tmp/pipeline-cookies.txt"
DRAMA_ID="$1"

[ -z "$DRAMA_ID" ] && { echo "Usage: $0 <drama_id>"; exit 1; }

# Login
CSRF=$(curl -s -c "$COOKIE" "$BASE/api/auth/csrf")
CSRF_TOKEN=$(echo "$CSRF" | python3 -c "import sys,json;print(json.load(sys.stdin).get('csrfToken',''))")
curl -s -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF_TOKEN" \
  --data-urlencode "email=abc@123.com" \
  --data-urlencode "password=test1234" \
  --data-urlencode "callbackUrl=$BASE" -o /dev/null

echo "Polling drama: $DRAMA_ID"
TRIGGERED=""

while true; do
  sleep 20
  
  R=$(curl -s --max-time 10 -b "$COOKIE" "$BASE/api/dramas/$DRAMA_ID" 2>/dev/null)
  STATUS=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('drama',{}).get('status','unknown'))" 2>/dev/null)
  
  echo "[$(date '+%H:%M:%S')] $STATUS"
  
  case "$STATUS" in
    script_generated|script_ready|storyboard_ready|storyboard_generated)
      [ "$TRIGGERED" != "sb" ] && {
        TRIGGERED="sb"
        echo "  → Triggering storyboard..."
        curl -s --max-time 10 -b "$COOKIE" -X POST "$BASE/api/generate/storyboard" \
          -H "Content-Type: application/json" -d "{\"dramaId\": \"$DRAMA_ID\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  Result:', d.get('message','') or d.get('error',''))" 2>/dev/null
      }
      ;;
    storyboard_generated|voiceover_ready)
      [ "$TRIGGERED" != "vo" ] && {
        TRIGGERED="vo"
        echo "  → Triggering voiceover..."
        curl -s --max-time 10 -b "$COOKIE" -X POST "$BASE/api/generate/voiceover" \
          -H "Content-Type: application/json" -d "{\"dramaId\": \"$DRAMA_ID\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  Result:', d.get('message','') or d.get('error',''))" 2>/dev/null
      }
      ;;
    voiceover_generated|video_ready)
      [ "$TRIGGERED" != "vid" ] && {
        TRIGGERED="vid"
        echo "  → Triggering video (LibLib Kling fix!)..."
        curl -s --max-time 10 -b "$COOKIE" -X POST "$BASE/api/generate/video" \
          -H "Content-Type: application/json" -d "{\"dramaId\": \"$DRAMA_ID\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  Result:', d.get('message','') or d.get('error',''))" 2>/dev/null
      }
      ;;
    completed)
      echo ""
      echo "🎉 Pipeline COMPLETE!"
      echo "   Drama ID: $DRAMA_ID"
      echo "   View: https://craftmind.cn/dramas/$DRAMA_ID"
      exit 0
      ;;
    error)
      echo "❌ Pipeline FAILED"
      exit 1
      ;;
  esac
done
